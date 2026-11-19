import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { auth, createEmailCodes, createSecurityAlerts } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import type { EmailCodePurpose, SecurityAlert } from "@openbeacon/email";
import { appRouter } from "../root.ts";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";

const prefix = `sign-in-codes-router-${crypto.randomUUID()}`;
const password = "testing-password-123";
const cache = createIntegrationTestCache(() => Date.now());
const codesSent: { to: string; purpose: EmailCodePurpose; code: string }[] = [];
const alertsSent: { userId: string; alert: SecurityAlert }[] = [];
const tasks: Promise<unknown>[] = [];
const emailCodes = createEmailCodes({
  minCheckMs: 0,
  db: prisma,
  secret: "integration-sign-in-codes-router-secret-000",
  rateLimits: cache.rateLimits,
  sendCodeEmail: async (email) => {
    codesSent.push(email);
  },
  sendAccountExistsEmail: async () => {},
  sendGoogleSignInEmail: async () => {},
});
const securityAlerts = createSecurityAlerts({
  db: prisma,
  sendSecurityAlertEmail: async ({ userId, alert }) => {
    alertsSent.push({ userId, alert });
  },
  runInBackground: (task) => tasks.push(task),
});
const sentAlerts = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
  return alertsSent.splice(0);
};

let accountCounter = 0;
const createAccount = async ({ google = false }: { google?: boolean } = {}) => {
  accountCounter += 1;
  const email = `${prefix}-${accountCounter}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Codes Test" } });
  if (google) {
    await prisma.account.updateMany({
      where: { userId: user.id },
      data: { providerId: "google", password: null },
    });
  }
  const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  const device = await prisma.userDevice.create({
    data: {
      activatedAt: new Date(),
      id: `${prefix}-device-${crypto.randomUUID()}`,
      userId: user.id,
      publicKey: "key",
      publicKeyAlgorithm: "X25519",
      name: "Sam's phone",
      icon: "phone",
    },
  });
  await prisma.session.update({ where: { id: session.id }, data: { deviceId: device.id } });
  return { email, userId: user.id, sessionId: session.id, deviceId: device.id };
};

const callerFor = (
  account: Awaited<ReturnType<typeof createAccount>>,
  {
    sessionCreatedAt = new Date(),
    codes = emailCodes,
  }: { sessionCreatedAt?: Date; codes?: typeof emailCodes | null } = {},
) =>
  appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      emailCodes: codes,
      securityAlerts,
      deviceId: account.deviceId,
      session: {
        user: { id: account.userId },
        session: { id: account.sessionId, createdAt: sessionCreatedAt },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );

const latestCode = (email: string) =>
  codesSent.findLast((message) => message.to === email)?.code ?? "";

const signInCodesOn = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { signInCodes: true } }))
    .signInCodes;

beforeEach(async () => {
  codesSent.length = 0;
  await sentAlerts();
});

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("sign-in codes settings", () => {
  test("a password account can turn codes on only when the server has email", async () => {
    const account = await createAccount();
    expect(await callerFor(account).signInCodes.status()).toEqual({ on: false, canTurnOn: true });
    expect(await callerFor(account, { codes: null }).signInCodes.status()).toEqual({
      on: false,
      canTurnOn: false,
    });
    await expect(
      callerFor(account, { codes: null }).signInCodes.requestTurnOnCode(),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a Google account can't turn codes on", async () => {
    const account = await createAccount({ google: true });
    expect(await callerFor(account).signInCodes.status()).toEqual({ on: false, canTurnOn: false });
    await expect(callerFor(account).signInCodes.requestTurnOnCode()).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(codesSent).toEqual([]);
  });

  test("turning codes on needs the emailed code and sends one alert", async () => {
    const account = await createAccount();
    const caller = callerFor(account);
    expect(await caller.signInCodes.requestTurnOnCode()).toEqual({ email: account.email });
    const code = latestCode(account.email);
    const wrong = ((Number(code) + 1) % 1_000_000).toString().padStart(6, "0");

    await expect(caller.signInCodes.turnOn({ code: wrong })).rejects.toMatchObject({
      cause: { reason: "INVALID_CODE" },
    });
    expect(await signInCodesOn(account.userId)).toBe(false);

    expect(await caller.signInCodes.turnOn({ code })).toEqual({ on: true });
    expect(await signInCodesOn(account.userId)).toBe(true);
    expect(await sentAlerts()).toEqual([
      { userId: account.userId, alert: { type: "sign-in-codes-turned-on" } },
    ]);
    expect(
      await prisma.accountNotice.findMany({
        where: { userId: account.userId },
        select: { type: true, excludeDeviceId: true },
      }),
    ).toEqual([{ type: "SIGN_IN_CODES_TURNED_ON", excludeDeviceId: account.deviceId }]);
  });

  test("turning codes on signs no session out", async () => {
    const account = await createAccount();
    await auth.api.signInEmail({ body: { email: account.email, password } });
    const caller = callerFor(account);
    await caller.signInCodes.requestTurnOnCode();
    await caller.signInCodes.turnOn({ code: latestCode(account.email) });
    expect(await prisma.session.count({ where: { userId: account.userId } })).toBe(2);
  });

  test("a sign-in code can't turn codes on", async () => {
    const account = await createAccount();
    const caller = callerFor(account);
    await caller.signInCodes.requestTurnOnCode();
    const turnOnCode = latestCode(account.email);
    await emailCodes.send({ purpose: "sign-in", subject: account.email, to: account.email });
    await expect(
      caller.signInCodes.turnOn({ code: latestCode(account.email) }),
    ).rejects.toMatchObject({ cause: { reason: "INVALID_CODE" } });
    expect(await signInCodesOn(account.userId)).toBe(false);
    expect(await caller.signInCodes.turnOn({ code: turnOnCode })).toEqual({ on: true });
  });

  test("turning codes off sends one alert, and only when they were on", async () => {
    const account = await createAccount();
    const caller = callerFor(account);
    expect(await caller.signInCodes.turnOff()).toEqual({ on: false });
    expect(await sentAlerts()).toEqual([]);

    await prisma.user.update({ where: { id: account.userId }, data: { signInCodes: true } });
    expect(await caller.signInCodes.turnOff()).toEqual({ on: false });
    expect(await signInCodesOn(account.userId)).toBe(false);
    expect(await sentAlerts()).toEqual([
      { userId: account.userId, alert: { type: "sign-in-codes-turned-off" } },
    ]);
    expect(
      await prisma.accountNotice.findMany({
        where: { userId: account.userId },
        select: { type: true, excludeDeviceId: true },
      }),
    ).toEqual([{ type: "SIGN_IN_CODES_TURNED_OFF", excludeDeviceId: account.deviceId }]);
  });

  test("changing codes needs a recent sign-in", async () => {
    const account = await createAccount();
    await prisma.user.update({ where: { id: account.userId }, data: { signInCodes: true } });
    const stale = callerFor(account, { sessionCreatedAt: new Date(Date.now() - 31 * 60_000) });
    const freshSignIn = { cause: { reason: "FRESH_SIGN_IN_REQUIRED" } };
    await expect(stale.signInCodes.requestTurnOnCode()).rejects.toMatchObject(freshSignIn);
    await expect(stale.signInCodes.turnOn({ code: "000000" })).rejects.toMatchObject(freshSignIn);
    await expect(stale.signInCodes.turnOff()).rejects.toMatchObject(freshSignIn);
    expect(await signInCodesOn(account.userId)).toBe(true);
    expect(codesSent).toEqual([]);
  });
});
