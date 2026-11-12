import { expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret } from "@openbeacon/cache/testing";
import { appRouter } from "../root.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

test("reports the server version and name", async () => {
  const caller = appRouter.createCaller({
    cache: new TestCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    }),
    clientIp: "203.0.113.10",
    serverVersion: "0.1.1",
    serverName: "Family server",
    db: {},
    deviceId: "device-1",
    deviceActive: true,
    session: { user: { id: "user-1", email: "user@example.com" } },
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);

  expect(await caller.account.version()).toBe("0.1.1");
  expect(await caller.account.serverName()).toBe("Family server");
});
