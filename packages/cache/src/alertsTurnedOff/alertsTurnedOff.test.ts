import { describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "../cache/OpenBeaconCache.ts";
import { FakeRedis } from "../rateLimits/testUtils.ts";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const createStore = () =>
  new TestOpenBeaconCache({ redisUrl: "redis://localhost:6379" }).alertsTurnedOff;

describe("OpenBeaconCache alertsTurnedOff", () => {
  test("keeps the first time and every alert added until taken", async () => {
    const store = createStore();

    expect(await store.add({ userId: "user-1", alerts: ["new-sign-in"], at: 1000 })).toBe(1000);
    expect(
      await store.add({
        userId: "user-1",
        alerts: ["new-sign-in", "deletion-scheduled"],
        at: 5000,
      }),
    ).toBe(1000);
    expect(await store.pending()).toEqual([{ userId: "user-1", firstAt: 1000 }]);

    const taken = await store.take({ userId: "user-1", firstAtOrBefore: 1000 });
    expect(taken?.firstAt).toBe(1000);
    expect(taken?.alerts.toSorted()).toEqual(["deletion-scheduled", "new-sign-in"]);
    expect(await store.pending()).toEqual([]);
  });

  test("only one caller can take the alerts", async () => {
    const store = createStore();
    await store.add({ userId: "user-1", alerts: ["new-sign-in"], at: 1000 });

    const results = await Promise.all([
      store.take({ userId: "user-1", firstAtOrBefore: 2000 }),
      store.take({ userId: "user-1", firstAtOrBefore: 2000 }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("leaves alerts that aren't due yet", async () => {
    const store = createStore();
    await store.add({ userId: "user-1", alerts: ["new-sign-in"], at: 1000 });

    expect(await store.take({ userId: "user-1", firstAtOrBefore: 999 })).toBeNull();
    expect(await store.pending()).toEqual([{ userId: "user-1", firstAt: 1000 }]);
  });
});
