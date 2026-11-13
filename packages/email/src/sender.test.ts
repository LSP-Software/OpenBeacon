import { describe, expect, mock, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, UnavailableRedis } from "@openbeacon/cache/testing";
import { createSendEmail } from "./sender.ts";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

class UnavailableCache extends OpenBeaconCache {
  protected override createRedisClient(): UnavailableRedis {
    return new UnavailableRedis();
  }
}

const setup = () => {
  const send = mock(async () => {});
  const sendEmail = createSendEmail({
    transport: { send, verify: async () => {} },
    rateLimits: new TestOpenBeaconCache({ redisUrl: "redis://localhost:6379" }).rateLimits,
  });
  return { send, sendEmail };
};

const message = {
  to: "owner@example.com",
  subject: "Subject",
  html: "<p>Body</p>",
  text: "Body",
  attachments: [],
};

describe("sendEmail", () => {
  test("sends nothing when email is off", async () => {
    const sendEmail = createSendEmail(null);
    expect(await sendEmail({ ...message, userId: "user-1", optional: false })).toEqual({
      sent: false,
      reason: "disabled",
    });
  });

  test("drops optional alerts once an account reaches its hourly cap", async () => {
    const { send, sendEmail } = setup();
    for (let index = 0; index < 20; index++) {
      expect(await sendEmail({ ...message, userId: "user-1", optional: true })).toEqual({
        sent: true,
      });
    }
    expect(await sendEmail({ ...message, userId: "user-1", optional: true })).toEqual({
      sent: false,
      reason: "capped",
    });
    expect(await sendEmail({ ...message, userId: "user-2", optional: true })).toEqual({
      sent: true,
    });
    expect(send).toHaveBeenCalledTimes(21);
  });

  test("always sends required email over the cap", async () => {
    const { send, sendEmail } = setup();
    for (let index = 0; index < 25; index++) {
      expect(await sendEmail({ ...message, userId: "user-1", optional: false })).toEqual({
        sent: true,
      });
    }
    expect(await sendEmail({ ...message, userId: "user-1", optional: true })).toEqual({
      sent: false,
      reason: "capped",
    });
    expect(send).toHaveBeenCalledTimes(25);
  });

  test("passes the message to the transport without the cap fields", async () => {
    const { send, sendEmail } = setup();
    await sendEmail({ ...message, userId: "user-1", optional: true });
    expect(send).toHaveBeenCalledWith(message);
  });

  test("skips optional alerts but still sends required mail while Redis is unavailable", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const send = mock(async () => {});
    const sendEmail = createSendEmail({
      transport: { send, verify: async () => {} },
      rateLimits: new UnavailableCache({ redisUrl: "redis://localhost:6379" }).rateLimits,
    });
    expect(await sendEmail({ ...message, userId: "user-1", optional: true })).toEqual({
      sent: false,
      reason: "unavailable",
    });
    expect(await sendEmail({ ...message, userId: "user-1", optional: false })).toEqual({
      sent: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
