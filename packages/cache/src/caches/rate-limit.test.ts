import { expect, jest, test } from "bun:test";
import type { RedisClient } from "bun";
import { RateLimitCache } from "./rate-limit.ts";

const createRedis = (response: [number, number]) =>
  ({
    send: jest.fn(async () => response),
  }) as unknown as RedisClient;

test("rate limit uses redis eval and returns remaining ttl", async () => {
  const redis = createRedis([5, 12]);
  const cache = new RateLimitCache(redis, "openbeacon");

  const result = await cache.check({
    ip: "1.2.3.4",
    path: "/health",
    limit: 10,
    windowSeconds: 60,
  });

  expect(result).toEqual({
    allowed: true,
    limit: 10,
    remaining: 5,
    resetSeconds: 12,
    totalRequests: 5,
  });

  expect((redis.send as ReturnType<typeof jest.fn>).mock.calls[0]?.[0]).toBe("EVAL");
});

test("rate limit falls back to window when ttl is not positive", async () => {
  const redis = createRedis([11, -1]);
  const cache = new RateLimitCache(redis, "openbeacon");

  const result = await cache.check({
    ip: "5.6.7.8",
    path: "/health",
    limit: 10,
    windowSeconds: 60,
  });

  expect(result).toEqual({
    allowed: false,
    limit: 10,
    remaining: 0,
    resetSeconds: 60,
    totalRequests: 11,
  });
});
