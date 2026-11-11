import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
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
  feedbackWebhookUrl = null,
  cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 }),
}: {
  create: ReturnType<typeof mock>;
  session: { user: { id: string; email: string } } | null;
  selfHosted?: boolean;
  feedbackWebhookUrl?: string | null;
  cache?: TestCache;
}) =>
  appRouter.createCaller({
    cache,
    clientIp: "203.0.113.10",
    serverVersion: "9.9.9",
    serverName: "Hosted",
    selfHosted,
    feedbackWebhookUrl,
    db: { feedback: { create } },
    session,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);

describe("feedback", () => {
  afterEach(() => {
    mock.restore();
  });

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
          select: { id: true },
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
          select: { id: true },
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
          select: { id: true },
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

  test("alerts Discord without sharing the message or email", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const create = mock(async () => ({ id: "feedback-1" }));
    const caller = createCaller({
      create,
      session: null,
      feedbackWebhookUrl: "https://discord.com/api/webhooks/1/token",
    });

    await caller.feedback.submit({ message: "secret @everyone", email: "user@example.com" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://discord.com/api/webhooks/1/token");
    const body = String(init?.body);
    expect(JSON.parse(body)).toEqual({
      content: "New feedback `feedback-1` (contact email included)",
      allowed_mentions: { parse: [] },
    });
    expect(body).not.toContain("secret");
    expect(body).not.toContain("user@example.com");
  });

  test("still accepts feedback when the Discord alert fails", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const create = mock(async () => ({ id: "feedback-1" }));
    const caller = createCaller({
      create,
      session: null,
      feedbackWebhookUrl: "https://discord.com/api/webhooks/1/token",
    });

    await caller.feedback.submit({ message: "hello" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("sends no alert when no webhook is configured", async () => {
    const fetchMock = spyOn(globalThis, "fetch");
    const create = mock(async () => ({ id: "feedback-1" }));
    const caller = createCaller({ create, session: null });

    await caller.feedback.submit({ message: "hello" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
