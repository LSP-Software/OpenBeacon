import { describe, expect, mock, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { FEEDBACK_MESSAGE_MAX_LENGTH } from "@openbeacon/schemas";
import { appRouter } from "../root.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const createCaller = ({
  create,
  session,
  selfHosted = false,
  cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
}: {
  create: ReturnType<typeof mock>;
  session: { user: { id: string; email: string } } | null;
  selfHosted?: boolean;
  cache?: TestCache;
}) =>
  appRouter.createCaller({
    cache,
    clientIp: "203.0.113.10",
    serverVersion: "9.9.9",
    serverName: "Hosted",
    selfHosted,
    db: { feedback: { create } },
    session,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);

describe("feedback", () => {
  test("accepts feedback without a session so self-hosted users can reach OpenBeacon", async () => {
    const create = mock(async () => ({}));
    const caller = createCaller({ create, session: null });

    await caller.feedback.submit({
      message: "  hello  ",
      androidVersion: " 15 ",
      appVersion: " 1.2.3 ",
      maplibreVersion: " 10.4.2 ",
      serverVersion: " 0.1.1 ",
    });
    await caller.feedback.submit({ message: "follow up", email: "user@example.com" });

    expect(create.mock.calls).toEqual([
      [
        {
          data: {
            message: "hello",
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
            email: "user@example.com",
            androidVersion: null,
            appVersion: null,
            maplibreVersion: null,
            serverVersion: null,
          },
        },
      ],
    ]);
  });

  test("never links feedback to the hosted session or uses the hosted server version", async () => {
    const create = mock(async () => ({}));
    const caller = createCaller({
      create,
      session: { user: { id: "user-1", email: "hosted@example.com" } },
    });

    await caller.feedback.submit({ message: "hello" });

    expect(create.mock.calls).toEqual([
      [
        {
          data: {
            message: "hello",
            email: null,
            androidVersion: null,
            appVersion: null,
            maplibreVersion: null,
            serverVersion: null,
          },
        },
      ],
    ]);
  });

  test("rejects invalid input", async () => {
    const create = mock(async () => ({}));
    const caller = createCaller({ create, session: null });

    await expect(caller.feedback.submit({ message: "  " })).rejects.toThrow();
    await expect(
      caller.feedback.submit({ message: "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1) }),
    ).rejects.toThrow();
    await expect(caller.feedback.submit({ message: "hi", androidVersion: " " })).rejects.toThrow();
    await expect(
      caller.feedback.submit({ message: "hi", email: "not-an-email" }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  test("rejects feedback on self-hosted servers so it only reaches OpenBeacon", async () => {
    const create = mock(async () => ({}));
    const caller = createCaller({ create, session: null, selfHosted: true });

    await expect(caller.feedback.submit({ message: "hello" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("rate limits anonymous submissions by IP", async () => {
    const create = mock(async () => ({}));
    const caller = createCaller({ create, session: null });

    for (let attempt = 0; attempt < 3; attempt++) {
      await caller.feedback.submit({ message: `message ${attempt}` });
    }

    await expect(caller.feedback.submit({ message: "one too many" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  test("shares the IP limit between requests with and without a session", async () => {
    const create = mock(async () => ({}));
    const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
    const signedIn = createCaller({
      create,
      session: { user: { id: "user-1", email: "user@example.com" } },
      cache,
    });
    const anonymous = createCaller({ create, session: null, cache });

    await signedIn.feedback.submit({ message: "one" });
    await signedIn.feedback.submit({ message: "two" });
    await anonymous.feedback.submit({ message: "three" });

    await expect(anonymous.feedback.submit({ message: "four" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(create).toHaveBeenCalledTimes(3);
  });
});
