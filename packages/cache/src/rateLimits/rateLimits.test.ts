import { describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "../cache/OpenBeaconCache.ts";
import { FakeRedis, testRedisHashSecret } from "./testUtils.ts";

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
          hashSecret: testRedisHashSecret,
        }),
    ).toThrow();

    expect(
      () =>
        new TestOpenBeaconCache({
          redisUrl: "https://example.com",
          hashSecret: testRedisHashSecret,
        }),
    ).toThrowError(expect.objectContaining({ message: expect.stringContaining("redis") }));

    expect(
      () =>
        new TestOpenBeaconCache({
          redisUrl: "redis://localhost:6379",
          hashSecret: testRedisHashSecret,
          now: () => Number.NaN,
        }),
    ).toThrow();

    expect(
      () =>
        new TestOpenBeaconCache({
          redisUrl: "redis://localhost:6379",
          hashSecret: testRedisHashSecret,
          now: () => {
            throw new Error("clock");
          },
        }),
    ).toThrow();

    expect(
      () =>
        new TestOpenBeaconCache({
          redisUrl: "redis://localhost:6379",
          hashSecret: testRedisHashSecret,
          now: () => Number.POSITIVE_INFINITY,
        }),
    ).toThrow();

    const nonNumericClock = () => "x";
    expect(
      () =>
        new TestOpenBeaconCache({
          redisUrl: "redis://localhost:6379",
          hashSecret: testRedisHashSecret,
          now: nonNumericClock as () => number,
        }),
    ).toThrow();

    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
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
      hashSecret: testRedisHashSecret,
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

  test("a refund gives a token back without going over the limit", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    });
    const input = {
      namespace: "auth.password",
      identifier: { type: "userId" as const, value: "user-1" },
      limit: 2,
      windowMs: 1_000,
    };

    await cache.rateLimits.consume(input);
    await cache.rateLimits.consume(input);
    expect((await cache.rateLimits.refund(input)).remaining).toBe(1);
    expect((await cache.rateLimits.refund(input)).remaining).toBe(2);
    expect((await cache.rateLimits.refund(input)).remaining).toBe(2);
    expect((await cache.rateLimits.consume(input)).remaining).toBe(1);
  });

  test("keeps IP addresses and email addresses out of rate limit keys", async () => {
    const keys: string[] = [];
    class RecordingCache extends OpenBeaconCache {
      protected override createRedisClient(): FakeRedis {
        const redis = new FakeRedis();
        const send = redis.send.bind(redis);
        redis.send = async (command, args) => {
          keys.push(args[2] ?? "");
          return send(command, args);
        };
        return redis;
      }
    }
    const createCache = (hashSecret: string) =>
      new RecordingCache({ redisUrl: "redis://localhost:6379", hashSecret, now: () => 0 });
    const cache = createCache(testRedisHashSecret);
    const limit = { namespace: "route", limit: 1, windowMs: 1_000 };

    await cache.rateLimits.consume({ ...limit, identifier: { type: "ip", value: "203.0.113.7" } });
    await cache.rateLimits.consume({
      ...limit,
      identifier: { type: "email", value: "sam@example.com" },
    });
    await cache.rateLimits.consume({ ...limit, identifier: { type: "userId", value: "user-1" } });
    await createCache("another-redis-hash-secret-0000000000").rateLimits.consume({
      ...limit,
      identifier: { type: "ip", value: "203.0.113.7" },
    });

    expect(keys.join(" ")).not.toContain("203.0.113.7");
    expect(keys.join(" ")).not.toContain("sam@example.com");
    expect(keys[2]).toBe("openbeacon:ratelimit:route:userId:user-1");
    expect(keys[3]).not.toBe(keys[0]);
    await expect(
      cache.rateLimits.peek({ ...limit, identifier: { type: "ip", value: "203.0.113.7" } }),
    ).resolves.toMatchObject({ remaining: 0 });
    await expect(
      cache.rateLimits.peek({ ...limit, identifier: { type: "ip", value: "203.0.113.8" } }),
    ).resolves.toMatchObject({ remaining: 1 });

    for (const identifier of [
      { type: "ip", value: "203.0.113.7" },
      { type: "email", value: "sam@example.com" },
    ] as const) {
      await expect(
        cache.rateLimits.reset({ namespace: limit.namespace, identifier }),
      ).resolves.toBe(1);
      await expect(cache.rateLimits.peek({ ...limit, identifier })).resolves.toMatchObject({
        remaining: 1,
      });
    }
  });

  test("refuses IP and email rate limits without a hash secret but allows user limits", async () => {
    const cache = new TestOpenBeaconCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
    const limit = { namespace: "route", limit: 1, windowMs: 1_000 };

    await expect(
      cache.rateLimits.consume({ ...limit, identifier: { type: "ip", value: "203.0.113.7" } }),
    ).rejects.toThrow("needs a hash secret");
    await expect(
      cache.rateLimits.reset({
        namespace: "route",
        identifier: { type: "email", value: "sam@example.com" },
      }),
    ).rejects.toThrow("needs a hash secret");
    await expect(
      cache.rateLimits.consume({ ...limit, identifier: { type: "userId", value: "user-1" } }),
    ).resolves.toMatchObject({ allowed: true });
  });

  test("stores and expires one pmtiles signed url per user and archive", async () => {
    let nowMs = 0;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;

    try {
      const cache = new TestOpenBeaconCache({
        redisUrl: "redis://localhost:6379",
        hashSecret: testRedisHashSecret,
        now: () => nowMs,
      });

      await expect(
        cache.pmtilesSignedUrls.get({ archiveId: "a-20261001", userId: "user-1" }),
      ).resolves.toBeNull();

      await expect(
        cache.pmtilesSignedUrls.set({
          archiveId: "a-20261001",
          expiresAt: new Date(10_000).toISOString(),
          url: "https://example.com/pmtiles-a",
          userId: "user-1",
        }),
      ).resolves.toBeUndefined();

      await expect(
        cache.pmtilesSignedUrls.get({ archiveId: "a-20261001", userId: "user-1" }),
      ).resolves.toEqual({
        expiresAt: new Date(10_000).toISOString(),
        url: "https://example.com/pmtiles-a",
      });

      await expect(
        cache.pmtilesSignedUrls.set({
          archiveId: "a-20261001",
          expiresAt: new Date(20_000).toISOString(),
          url: "https://example.com/pmtiles-b",
          userId: "user-1",
        }),
      ).resolves.toBeUndefined();

      await expect(
        cache.pmtilesSignedUrls.get({ archiveId: "a-20261001", userId: "user-1" }),
      ).resolves.toEqual({
        expiresAt: new Date(20_000).toISOString(),
        url: "https://example.com/pmtiles-b",
      });

      await cache.pmtilesSignedUrls.set({
        archiveId: "b-20261101",
        expiresAt: new Date(20_000).toISOString(),
        url: "https://example.com/pmtiles-other-archive",
        userId: "user-1",
      });

      await expect(
        cache.pmtilesSignedUrls.get({ archiveId: "a-20261001", userId: "user-1" }),
      ).resolves.toEqual({
        expiresAt: new Date(20_000).toISOString(),
        url: "https://example.com/pmtiles-b",
      });

      nowMs = 25_000;

      await expect(
        cache.pmtilesSignedUrls.get({ archiveId: "a-20261001", userId: "user-1" }),
      ).resolves.toBeNull();
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("rejects rate limit operations when redis client is closed", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
    });
    cache.close();

    await expect(
      cache.rateLimits.consume({
        namespace: "route",
        identifier: {
          type: "ip",
          value: "127.0.0.1",
        },
        limit: 1,
        windowMs: 1_000,
      }),
    ).rejects.toThrow("Redis client is closed.");

    await expect(
      cache.rateLimits.peek({
        namespace: "route",
        identifier: {
          type: "ip",
          value: "127.0.0.1",
        },
        limit: 1,
        windowMs: 1_000,
      }),
    ).rejects.toThrow("Redis client is closed.");

    await expect(
      cache.rateLimits.reset({
        namespace: "route",
        identifier: {
          type: "ip",
          value: "127.0.0.1",
        },
      }),
    ).rejects.toThrow("Redis client is closed.");
  });
});
