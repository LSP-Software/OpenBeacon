import { afterAll, describe, expect, test } from "bun:test";
import { FakeRedis } from "../rateLimits/testUtils.ts";
import { OpenBeaconCache } from "./OpenBeaconCache.ts";

class FakeRedisCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

let nowMs = 0;
const caches = [
  {
    name: "Redis",
    cache: new OpenBeaconCache({
      redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
      keyPrefix: `test-${crypto.randomUUID()}`,
      now: () => nowMs,
    }),
  },
  {
    name: "FakeRedis",
    cache: new FakeRedisCache({ redisUrl: "redis://localhost:6379", now: () => nowMs }),
  },
];

afterAll(() => {
  for (const { cache } of caches) cache.close();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("OpenBeaconCache scripts", () => {
  test.each(caches)(
    "$name runs the token bucket as rateLimits.test.ts expects",
    async ({ cache }) => {
      nowMs = 0;
      const input = {
        namespace: "auth.registerDeviceKey",
        identifier: { type: "userId" as const, value: "user-1" },
        limit: 2,
        windowMs: 1_000,
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
      expect(await cache.rateLimits.consume(input)).toEqual(result(true, 1, 0, 500));
      expect(await cache.rateLimits.consume(input)).toEqual(result(true, 0, 0, 1_000));
      expect(await cache.rateLimits.consume(input)).toEqual(result(false, 0, 500, 1_000));

      nowMs = 500;
      expect(await cache.rateLimits.consume(input)).toEqual(result(true, 0, 0, 1_000));

      nowMs = 750;
      expect(await cache.rateLimits.consume(input)).toEqual(result(false, 0, 250, 750));
      expect(await cache.rateLimits.peek({ ...input, cost: 0 })).toEqual(result(true, 0, 0, 750));

      nowMs = 1_500;
      expect(await cache.rateLimits.peek(input)).toEqual(result(true, 2, 0, 0));
      expect(await cache.rateLimits.consume({ ...input, cost: 2 })).toEqual(
        result(true, 0, 0, 1_000),
      );
      expect(await cache.rateLimits.consume({ ...input, cost: 2 })).toEqual(
        result(false, 0, 1_000, 1_000),
      );

      expect(await cache.rateLimits.reset(input)).toBe(1);
      expect(await cache.rateLimits.reset(input)).toBe(0);
      expect(await cache.rateLimits.peek(input)).toEqual(result(true, 2, 0, 0));
      expect(await cache.rateLimits.reset(input)).toBe(1);
    },
  );

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
