import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { auth, createSecurityAlerts } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import type { SecurityAlert } from "@openbeacon/email";
import { appRouter } from "../root.ts";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";

const prefix = `sign-out-others-${crypto.randomUUID()}`;
const password = "testing-password-123";
const cache = createIntegrationTestCache(() => 0);
const sent: { userId: string; alert: SecurityAlert }[] = [];
const tasks: Promise<unknown>[] = [];
const securityAlerts = createSecurityAlerts({
  db: prisma,
  sendSecurityAlertEmail: async ({ userId, alert }) => {
    sent.push({ userId, alert });
  },
  runInBackground: (task) => tasks.push(task),
});
const sentAlerts = async () => {
  while (tasks.length) await Promise.all(tasks.splice(0));
  return sent.splice(0);
};

let accountCounter = 0;
const createAccount = async () => {
  accountCounter += 1;
  const email = `${prefix}-${accountCounter}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Sessions Test" } });
  await auth.api.signInEmail({ body: { email, password } });
  await auth.api.signInEmail({ body: { email, password } });
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: "asc" },
    where: { userId: user.id },
  });
  const device = await prisma.userDevice.create({
    data: {
      activatedAt: new Date(),
      id: `${prefix}-device-${crypto.randomUUID()}`,
      userId: user.id,
      publicKey: "key",
      publicKeyAlgorithm: "X25519",
      model: "Pixel 9",
      platform: "android",
      name: "Sam's phone",
      icon: "phone",
    },
  });
  await prisma.session.update({
    where: { id: sessions.at(-1)?.id },
    data: { deviceId: device.id },
  });
  return { userId: user.id, sessions, deviceId: device.id };
};

const callerFor = (
  account: Awaited<ReturnType<typeof createAccount>>,
  { sessionCreatedAt = new Date() }: { sessionCreatedAt?: Date } = {},
) => {
  const current = account.sessions.at(-1);
  if (!current) throw new Error("The account has no session");
  return appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      emailCodes: null,
      securityAlerts,
      clientIp: `ip-${account.userId}`,
      deviceId: account.deviceId,
      session: {
        user: { id: account.userId },
        session: { id: current.id, createdAt: sessionCreatedAt },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );
};

const sessionIds = async (userId: string) =>
  (await prisma.session.findMany({ select: { id: true }, where: { userId } })).map(({ id }) => id);

beforeEach(async () => {
  await sentAlerts();
});

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("signing out other sessions", () => {
  test("ends every other session for the account and keeps this one", async () => {
    const account = await createAccount();
    const otherAccount = await createAccount();
    expect(account.sessions).toHaveLength(3);

    expect(await callerFor(account).account.signOutOtherSessions()).toEqual({ signedOut: 2 });

    expect(await sessionIds(account.userId)).toEqual([account.sessions.at(-1)?.id]);
    expect(await sessionIds(otherAccount.userId)).toHaveLength(3);
  });

  test("sends one always-on alert, even with optional alerts off", async () => {
    const account = await createAccount();
    await prisma.user.update({
      where: { id: account.userId },
      data: { alertNewDevice: false, alertDeletionScheduled: false },
    });

    await callerFor(account).account.signOutOtherSessions();

    expect(await sentAlerts()).toEqual([
      {
        userId: account.userId,
        alert: {
          type: "other-sessions-signed-out",
          device: { name: "Sam's phone", model: "Pixel 9", platform: "android" },
        },
      },
    ]);
  });

  test("names the device that signed the others out", async () => {
    const account = await createAccount();

    await callerFor(account).account.signOutOtherSessions();

    expect(await sentAlerts()).toEqual([
      {
        userId: account.userId,
        alert: {
          type: "other-sessions-signed-out",
          device: { name: "Sam's phone", model: "Pixel 9", platform: "android" },
        },
      },
    ]);
  });

  test("sends no alert when there were no other sessions", async () => {
    const account = await createAccount();
    const caller = callerFor(account);
    await caller.account.signOutOtherSessions();
    await sentAlerts();

    expect(await caller.account.signOutOtherSessions()).toEqual({ signedOut: 0 });
    expect(await sentAlerts()).toEqual([]);
  });

  test("clears expired sessions without counting them or sending an alert", async () => {
    const account = await createAccount();
    const [expired, live] = account.sessions;
    await prisma.session.update({
      where: { id: expired?.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.session.delete({ where: { id: live?.id } });

    expect(await callerFor(account).account.signOutOtherSessions()).toEqual({ signedOut: 0 });

    expect(await sessionIds(account.userId)).toEqual([account.sessions.at(-1)?.id]);
    expect(await sentAlerts()).toEqual([]);
  });

  test("needs a sign-in from the last 30 minutes", async () => {
    const account = await createAccount();
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

    await expect(
      callerFor(account, { sessionCreatedAt: minutesAgo(31) }).account.signOutOtherSessions(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await sessionIds(account.userId)).toHaveLength(3);
    expect(await sentAlerts()).toEqual([]);

    expect(
      await callerFor(account, { sessionCreatedAt: minutesAgo(29) }).account.signOutOtherSessions(),
    ).toEqual({ signedOut: 2 });
  });
});
