import { afterAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "../integrationTestCache.ts";
import { FakeRedis } from "../rateLimits/testUtils.ts";
import { OpenBeaconCache } from "./OpenBeaconCache.ts";

class FakeRedisCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

let nowMs = 0;
const fakeRedisCache = new FakeRedisCache({ redisUrl: "redis://localhost:6379", now: () => nowMs });
afterAll(() => fakeRedisCache.close());

const caches = [
  { name: "Redis", cache: createIntegrationTestCache(() => nowMs) },
  { name: "FakeRedis", cache: fakeRedisCache },
];

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("OpenBeaconCache scripts", () => {
  test.each(caches)(
    "$name runs the token bucket as rateLimits.test.ts expects",
    async ({ cache }) => {
      nowMs = 0;
      const input = {
        namespace: "auth.registerDeviceKey",
        identifier: { type: "userId" as const, value: "user-1" },
        limit: 2,
        windowMs: 60_000,
      };
      const result = (
        allowed: boolean,
        remaining: number,
        retryAfterMs: number,
        resetAfterMs: number,
      ) => ({
        allowed,
        limit: 2,
        remaining,
        retryAfterMs,
        resetAfterMs,
      });

      expect(await cache.rateLimits.peek(input)).toEqual(result(true, 2, 0, 0));
      expect(await cache.rateLimits.consume(input)).toEqual(result(true, 1, 0, 30_000));
      expect(await cache.rateLimits.consume(input)).toEqual(result(true, 0, 0, 60_000));
      expect(await cache.rateLimits.consume(input)).toEqual(result(false, 0, 30_000, 60_000));

      nowMs = 30_000;
      expect(await cache.rateLimits.consume(input)).toEqual(result(true, 0, 0, 60_000));

      nowMs = 45_000;
      expect(await cache.rateLimits.consume(input)).toEqual(result(false, 0, 15_000, 45_000));
      expect(await cache.rateLimits.peek({ ...input, cost: 0 })).toEqual(
        result(true, 0, 0, 45_000),
      );

      nowMs = 90_000;
      expect(await cache.rateLimits.peek(input)).toEqual(result(true, 2, 0, 0));
      expect(await cache.rateLimits.consume({ ...input, cost: 2 })).toEqual(
        result(true, 0, 0, 60_000),
      );
      expect(await cache.rateLimits.consume({ ...input, cost: 2 })).toEqual(
        result(false, 0, 60_000, 60_000),
      );

      expect(await cache.rateLimits.reset(input)).toBe(1);
      expect(await cache.rateLimits.reset(input)).toBe(0);
      expect(await cache.rateLimits.peek(input)).toEqual(result(true, 2, 0, 0));
      expect(await cache.rateLimits.reset(input)).toBe(1);
    },
  );

  test.each(caches)("$name stores, replaces and resets signed map URLs", async ({ cache }) => {
    nowMs = Date.now();
    const store = cache.pmtilesSignedUrls;
    const first = {
      expiresAt: new Date(nowMs + 60_000).toISOString(),
      url: "https://tiles.example.com/map.pmtiles?signature=first",
    };
    const second = {
      expiresAt: new Date(nowMs + 120_000).toISOString(),
      url: "https://tiles.example.com/map.pmtiles?signature=second",
    };

    expect(await store.get({ userId: "user-1" })).toBeNull();
    await store.set({ userId: "user-1", ...first });
    expect(await store.get({ userId: "user-1" })).toEqual(first);
    await store.set({ userId: "user-1", ...second });
    expect(await store.get({ userId: "user-1" })).toEqual(second);
    expect(await store.get({ userId: "user-2" })).toBeNull();

    expect(await store.reset({ userId: "user-1" })).toBe(1);
    expect(await store.get({ userId: "user-1" })).toBeNull();
    expect(await store.reset({ userId: "user-1" })).toBe(0);
  });

  test.each(caches)(
    "$name keeps turned-off alerts until they are due and taken",
    async ({ cache }) => {
      const store = cache.alertsTurnedOff;

      expect(await store.add({ userId: "user-1", alerts: ["new-device"], at: 1_000 })).toBe(1_000);
      expect(
        await store.add({
          userId: "user-1",
          alerts: ["new-device", "deletion-scheduled"],
          at: 5_000,
        }),
      ).toBe(1_000);
      expect(await store.add({ userId: "user-2", alerts: ["new-device"], at: 3_000 })).toBe(3_000);
      expect(await store.pending()).toEqual([
        { userId: "user-1", firstAt: 1_000 },
        { userId: "user-2", firstAt: 3_000 },
      ]);

      expect(await store.take({ userId: "user-2", firstAtOrBefore: 2_999 })).toBeNull();
      const taken = await store.take({ userId: "user-1", firstAtOrBefore: 1_000 });
      expect(taken?.firstAt).toBe(1_000);
      expect(taken?.alerts.toSorted()).toEqual(["deletion-scheduled", "new-device"]);
      expect(await store.take({ userId: "user-1", firstAtOrBefore: 1_000 })).toBeNull();
      expect(await store.pending()).toEqual([{ userId: "user-2", firstAt: 3_000 }]);

      expect(await store.take({ userId: "user-2", firstAtOrBefore: 3_000 })).toEqual({
        firstAt: 3_000,
        alerts: ["new-device"],
      });
      expect(await store.pending()).toEqual([]);
    },
  );
});
