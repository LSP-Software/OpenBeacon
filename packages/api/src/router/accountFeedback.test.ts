import { describe, expect, mock, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { appRouter } from "../root.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

describe("feedback", () => {
  test("stores the account email only when requested", async () => {
    const create = mock(async () => ({}));
    const caller = appRouter.createCaller({
      cache: new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
      clientIp: "203.0.113.10",
      serverVersion: "0.1.1",
      db: { feedback: { create } },
      session: { user: { id: "user-1", email: "user@example.com" } },
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);

    expect(await caller.account.version()).toBe("0.1.1");
    await caller.account.submitFeedback({
      message: "  hello  ",
      includeEmail: false,
      androidVersion: " 15 ",
      appVersion: " 1.2.3 ",
      maplibreVersion: " 10.4.2 ",
    });
    await caller.account.submitFeedback({ message: "follow up", includeEmail: true });
    expect(create.mock.calls).toEqual([
      [
        {
          data: {
            message: "hello",
            userId: "user-1",
            email: null,
            androidVersion: "15",
            appVersion: "1.2.3",
            maplibreVersion: "10.4.2",
            serverVersion: "0.1.1",
          },
        },
      ],
      [
        {
          data: {
            message: "follow up",
            userId: "user-1",
            email: "user@example.com",
            androidVersion: null,
            appVersion: null,
            maplibreVersion: null,
            serverVersion: "0.1.1",
          },
        },
      ],
    ]);
    await expect(
      caller.account.submitFeedback({ message: "  ", includeEmail: false }),
    ).rejects.toThrow();
    await expect(
      caller.account.submitFeedback({ message: "hello", includeEmail: false, androidVersion: " " }),
    ).rejects.toThrow();
  });
});
