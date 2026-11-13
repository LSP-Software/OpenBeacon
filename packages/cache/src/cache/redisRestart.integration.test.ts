import { afterAll, expect, test } from "bun:test";
import { $ } from "bun";
import { testRedisHashSecret } from "../rateLimits/testUtils.ts";
import { OpenBeaconCache } from "./OpenBeaconCache.ts";

const container = process.env["REDIS_RESTART_CONTAINER"];
const cache = new OpenBeaconCache({
  redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  hashSecret: testRedisHashSecret,
  keyPrefix: `test-${crypto.randomUUID()}`,
});
afterAll(() => cache.close());

const limit = {
  namespace: "restart",
  identifier: { type: "userId" as const, value: "user" },
  limit: 1_000,
  windowMs: 60_000,
};

test.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1" || !container)(
  "the shared client recovers after Redis is down for longer than Bun's own retries",
  async () => {
    expect((await cache.rateLimits.consume(limit)).allowed).toBe(true);
    await $`docker stop ${container ?? ""}`.quiet();
    try {
      await Bun.sleep(35_000);
      const started = performance.now();
      await expect(cache.rateLimits.consume(limit)).rejects.toThrow();
      expect(await cache.rateLimits.consume(limit, { whenUnavailable: "allow" })).toMatchObject({
        allowed: true,
        unavailable: true,
      });
      expect(await cache.rateLimits.consume(limit, { whenUnavailable: "deny" })).toMatchObject({
        allowed: false,
        unavailable: true,
      });
      expect(await cache.ping()).toBe(false);
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally {
      await $`docker start ${container ?? ""}`.quiet();
    }
    const deadline = Date.now() + 20_000;
    while (!(await cache.ping()) && Date.now() < deadline) await Bun.sleep(250);
    expect(await cache.ping()).toBe(true);
    expect((await cache.rateLimits.consume(limit)).allowed).toBe(true);
  },
  90_000,
);
