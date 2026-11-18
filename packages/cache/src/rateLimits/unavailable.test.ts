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

test("a take grants the whole cost when it stays open and nothing when it stays closed", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  expect(await cache.rateLimits.take({ ...limit, cost: 4 }, { whenUnavailable: "allow" })).toEqual({
    granted: 4,
    remaining: 10,
    unavailable: true,
  });
  expect(await cache.rateLimits.take({ ...limit, cost: 4 }, { whenUnavailable: "deny" })).toEqual({
    granted: 0,
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

class FailingCache extends OpenBeaconCache {
  constructor(private readonly failure: Error & { code: string }) {
    super({ redisUrl: "redis://localhost:6379", hashSecret: testRedisHashSecret });
  }

  protected override createRedisClient() {
    return {
      send: async () => {
        throw this.failure;
      },
      del: async () => {
        throw this.failure;
      },
      close: () => {},
    };
  }
}

test("a Redis that is up but refuses the call is not treated as an outage", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  const refusing = new FailingCache(
    Object.assign(new Error("NOPERM this user has no permissions"), {
      code: "ERR_REDIS_SERVER_ERROR",
    }),
  );
  await expect(
    refusing.rateLimits.consume(limit, { whenUnavailable: "allow" }),
  ).rejects.toMatchObject({ code: "ERR_REDIS_SERVER_ERROR" });
  await expect(refusing.rateLimits.peek(limit, { whenUnavailable: "deny" })).rejects.toThrow(
    "NOPERM",
  );
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test("a call that times out is treated as an outage", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  const slow = new FailingCache(
    Object.assign(new Error("Redis didn't answer in time"), { code: "ERR_REDIS_TIMEOUT" }),
  );
  expect(await slow.rateLimits.consume(limit, { whenUnavailable: "allow" })).toMatchObject({
    allowed: true,
    unavailable: true,
  });
  error.mockRestore();
});

test("rate limiting by email without a hash secret fails loudly instead of looking like an outage", async () => {
  const noSecret = new (class extends OpenBeaconCache {
    protected override createRedisClient(): UnavailableRedis {
      return new UnavailableRedis();
    }
  })({ redisUrl: "redis://localhost:6379" });
  await expect(
    noSecret.rateLimits.consume(
      { ...limit, identifier: { type: "email", value: "a@example.com" } },
      { whenUnavailable: "allow" },
    ),
  ).rejects.toThrow("needs a hash secret");
});
