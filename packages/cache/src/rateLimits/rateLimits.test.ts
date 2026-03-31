import { describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "../cache/OpenBeaconCache.ts";
import { FakeRedis } from "./testUtils.ts";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

describe("OpenBeaconCache rateLimits", () => {
  test("rejects invalid constructor and method inputs", async () => {
    expect(
      () =>
        new TestOpenBeaconCache({
          redisUrl: "not-a-url",
        }),
    ).toThrow();

    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
    });

    await expect(
      cache.rateLimits.consume({
        namespace: "",
        identifier: {
          type: "userId",
          value: "user-1",
        },
        limit: 60,
        windowMs: 60_000,
      }),
    ).rejects.toThrow();

    await expect(
      cache.rateLimits.peek({
        namespace: "route",
        identifier: {
          type: "ip",
          value: "127.0.0.1",
        },
        limit: 0,
        windowMs: 60_000,
      }),
    ).rejects.toThrow();

    await expect(
      cache.rateLimits.reset({
        namespace: "route",
        identifier: {
          type: "ip",
          value: "",
        },
      }),
    ).rejects.toThrow();
  });

  test("consumes tokens, refills over time, and resets state", async () => {
    let nowMs = 0;
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      now: () => nowMs,
    });

    const input = {
      namespace: "auth.registerDeviceKey",
      identifier: {
        type: "userId" as const,
        value: "user-1",
      },
      limit: 2,
      windowMs: 1_000,
    };

    await expect(cache.rateLimits.peek(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 2,
      retryAfterMs: 0,
      resetAfterMs: 0,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterMs: 0,
      resetAfterMs: 500,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      retryAfterMs: 0,
      resetAfterMs: 1_000,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterMs: 500,
      resetAfterMs: 1_000,
    });

    nowMs = 500;

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      retryAfterMs: 0,
      resetAfterMs: 1_000,
    });

    nowMs = 1_500;

    await expect(cache.rateLimits.peek(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 2,
      retryAfterMs: 0,
      resetAfterMs: 0,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterMs: 0,
      resetAfterMs: 500,
    });

    await expect(
      cache.rateLimits.reset({
        namespace: input.namespace,
        identifier: input.identifier,
      }),
    ).resolves.toBe(1);

    await expect(cache.rateLimits.peek(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 2,
      retryAfterMs: 0,
      resetAfterMs: 0,
    });
  });

  test("stores and expires a single pmtiles signed url per user", async () => {
    let nowMs = 0;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      now: () => nowMs,
    });

    await expect(cache.pmtilesSignedUrls.get({ userId: "user-1" })).resolves.toBeNull();

    await expect(
      cache.pmtilesSignedUrls.set({
        expiresAt: new Date(10_000).toISOString(),
        url: "https://example.com/pmtiles-a",
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();

    await expect(cache.pmtilesSignedUrls.get({ userId: "user-1" })).resolves.toEqual({
      expiresAt: new Date(10_000).toISOString(),
      url: "https://example.com/pmtiles-a",
    });

    await expect(
      cache.pmtilesSignedUrls.set({
        expiresAt: new Date(20_000).toISOString(),
        url: "https://example.com/pmtiles-b",
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();

    await expect(cache.pmtilesSignedUrls.get({ userId: "user-1" })).resolves.toEqual({
      expiresAt: new Date(20_000).toISOString(),
      url: "https://example.com/pmtiles-b",
    });

    nowMs = 25_000;

    await expect(cache.pmtilesSignedUrls.get({ userId: "user-1" })).resolves.toBeNull();
    Date.now = originalDateNow;
  });
});
