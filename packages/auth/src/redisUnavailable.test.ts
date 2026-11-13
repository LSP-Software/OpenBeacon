import { expect, mock, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { testRedisHashSecret, UnavailableRedis } from "@openbeacon/cache/testing";
import type { PrismaClient } from "@openbeacon/database";
import { createAuth } from "./createAuth.ts";
import { createEmailCodes } from "./emailCode.ts";
import { createSecurityAlerts } from "./securityAlerts.ts";

class UnavailableCache extends OpenBeaconCache {
  protected override createRedisClient(): UnavailableRedis {
    return new UnavailableRedis();
  }
}

const cache = new UnavailableCache({
  redisUrl: "redis://localhost:6379",
  hashSecret: testRedisHashSecret,
});

const verification = {
  id: "verification",
  value: "00".repeat(32),
  expiresAt: new Date(Date.now() + 60_000),
};
const tx = {
  $queryRaw: async () => [{ acquired: true }],
  verification: {
    findFirst: async () => verification,
    updateMany: mock(async () => ({ count: 1 })),
    deleteMany: mock(async () => ({ count: 1 })),
  },
};
const codes = createEmailCodes({
  db: {
    verification: { findFirst: async () => ({ id: verification.id }) },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaClient,
  secret: "unit-email-code-secret-0000000000000000",
  rateLimits: cache.rateLimits,
  sendCodeEmail: async () => {},
  sendAccountExistsEmail: async () => {},
  sendGoogleSignInEmail: async () => {},
});

test("email code requests are refused while Redis is unavailable", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  expect(await codes.allowRequest({ purpose: "sign-up", email: "a@example.test" })).toBe(
    "unavailable",
  );
  error.mockRestore();
});

test("a code can't be checked while Redis is unavailable, so guesses aren't uncounted", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  expect(
    await codes.check({ purpose: "sign-up", subject: "a@example.test", code: "123456" }),
  ).toEqual({ valid: false, reason: "invalid" });
  expect(tx.verification.updateMany).not.toHaveBeenCalled();
  expect(tx.verification.deleteMany).not.toHaveBeenCalled();
  error.mockRestore();
});

test("alerts-turned-off is sent straight away when it can't be held in Redis", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  const tasks: Promise<unknown>[] = [];
  const sendSecurityAlertEmail = mock(async () => ({ sent: true }) as const);
  const alerts = createSecurityAlerts({
    db: {
      user: {
        findUnique: async () => ({
          accounts: [],
          alertDeletionScheduled: true,
          alertNewSignIn: true,
          email: "owner@example.test",
          id: "user-1",
          timezone: "UTC",
        }),
      },
    } as unknown as Pick<PrismaClient, "user">,
    sendSecurityAlertEmail,
    alertsTurnedOff: cache.alertsTurnedOff,
    runInBackground: (task) => tasks.push(task),
    setTimer: () => {
      throw new Error("The alert shouldn't be batched");
    },
  });
  alerts.turnedOff("user-1", ["new-sign-in"]);
  while (tasks.length) await Promise.all(tasks.splice(0));
  expect(sendSecurityAlertEmail).toHaveBeenCalledTimes(1);
  expect(sendSecurityAlertEmail.mock.calls[0]?.[0]).toMatchObject({
    alert: { type: "alerts-turned-off", alerts: ["new-sign-in"] },
    to: "owner@example.test",
  });
  error.mockRestore();
});

test("password sign-in is refused while Redis is unavailable, so failures aren't uncounted", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  const auth = createAuth({ emailCodes: null, securityAlerts: null, rateLimits: cache.rateLimits });
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.test", password: "correct horse battery" }),
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    code: "PASSWORD_CHECK_UNAVAILABLE",
    message: "Passwords can't be checked right now. Try again shortly.",
  });
  error.mockRestore();
});
