import { expect, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "../cache/OpenBeaconCache.ts";
import { testRedisHashSecret, UnavailableRedis } from "./testUtils.ts";

class UnavailableCache extends OpenBeaconCache {
  protected override createRedisClient(): UnavailableRedis {
    return new UnavailableRedis();
  }
}

const cache = new UnavailableCache({
  redisUrl: "redis://localhost:6379",
  hashSecret: testRedisHashSecret,
});
const limit = {
  namespace: "example",
  identifier: { type: "userId" as const, value: "user-1" },
  limit: 10,
  windowMs: 60_000,
};

test("a caller that chose to stay open is allowed and the outage is logged", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  expect(await cache.rateLimits.consume(limit, { whenUnavailable: "allow" })).toEqual({
    allowed: true,
    limit: 10,
    remaining: 10,
    retryAfterMs: 0,
    resetAfterMs: 0,
    unavailable: true,
  });
  expect(error.mock.calls).toEqual([
    ["[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so example is allowed"],
  ]);
  error.mockRestore();
});

test("a caller that chose to stay closed is refused", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  expect(await cache.rateLimits.peek(limit, { whenUnavailable: "deny" })).toMatchObject({
    allowed: false,
    remaining: 0,
    unavailable: true,
  });
  error.mockRestore();
});

test("a caller that chose nothing gets the Redis error, and bad input still throws", async () => {
  await expect(cache.rateLimits.consume(limit)).rejects.toMatchObject({
    code: "ERR_REDIS_CONNECTION_CLOSED",
  });
  await expect(
    cache.rateLimits.consume({ ...limit, limit: 0 }, { whenUnavailable: "allow" }),
  ).rejects.toThrow();
});

test("ping reports false instead of throwing", async () => {
  expect(await cache.ping()).toBe(false);
});
