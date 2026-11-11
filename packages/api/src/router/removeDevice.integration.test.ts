import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { auth, createSecurityAlerts } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import type { SecurityAlert } from "@openbeacon/email";
import { deviceIdHeader, deviceRemovedCause, tryCatch } from "@openbeacon/shared";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { DeviceRemovedError } from "../lib/deviceRemoved.ts";
import { upsertUserDevice } from "../lib/groupEpochs.ts";
import { linkRequestDevice } from "../lib/requestDevice.ts";
import { appRouter } from "../root.ts";
import { createTRPCContext } from "../trpc.ts";

const prefix = `remove-device-${crypto.randomUUID()}`;
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
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Remove Test" } });
  await auth.api.signInEmail({ body: { email, password } });
  await auth.api.signInEmail({ body: { email, password } });
  const [lost, unlinked, current] = await prisma.session.findMany({
    orderBy: { createdAt: "asc" },
    where: { userId: user.id },
  });
  if (!lost || !unlinked || !current) throw new Error("Expected three sessions");
  const createDevice = (name: string) =>
    prisma.userDevice.create({
      data: {
        id: `${prefix}-${name}-${crypto.randomUUID()}`,
        userId: user.id,
        publicKey: `${name}-key`,
        publicKeyAlgorithm: "X25519",
        model: "Pixel 9",
        platform: "android",
        name,
        icon: "phone",
      },
    });
  const thisPhone = await createDevice("This phone");
  const lostPhone = await createDevice("Lost phone");
  await prisma.session.update({ where: { id: current.id }, data: { deviceId: thisPhone.id } });
  await prisma.session.update({ where: { id: lost.id }, data: { deviceId: lostPhone.id } });
  const group = await prisma.group.create({
    data: {
      name: "Family",
      groupMembers: { create: { userId: user.id, role: "OWNER", joinedEpochNumber: 1 } },
    },
  });
  return {
    userId: user.id,
    groupId: group.id,
    thisPhone,
    lostPhone,
    sessions: { lost: lost.id, unlinked: unlinked.id, current: current.id },
  };
};

type Account = Awaited<ReturnType<typeof createAccount>>;

const callerFor = (account: Account, { deviceId = account.thisPhone.id } = {}) =>
  appRouter.createCaller({
    cache,
    db: prisma,
    emailCodes: null,
    securityAlerts,
    clientIp: `ip-${account.userId}`,
    deviceId,
    session: {
      user: { id: account.userId },
      session: { id: account.sessions.current, createdAt: new Date() },
    },
  } as Parameters<typeof appRouter.createCaller>[0]);

const sessionIds = async (userId: string) =>
  (await prisma.session.findMany({ select: { id: true }, where: { userId } }))
    .map(({ id }) => id)
    .sort();

const revokedAt = async (deviceId: string) =>
  (await prisma.userDevice.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt;

const expectDeviceRemoved = (error: unknown) => {
  expect(error).toMatchObject({ code: "UNAUTHORIZED" });
  expect((error as { cause?: unknown }).cause).toBeInstanceOf(DeviceRemovedError);
};

beforeEach(async () => {
  await sentAlerts();
});

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });
  await prisma.group.deleteMany({
    where: { groupMembers: { some: { userId: { in: users.map(({ id }) => id) } } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("removing a device", () => {
  test("revokes the device, signs it out, keeps this session and flags rotation", async () => {
    const account = await createAccount();
    const other = await createAccount();

    await callerFor(account).account.removeDevice({ deviceId: account.lostPhone.id });

    expect(await revokedAt(account.lostPhone.id)).toBeInstanceOf(Date);
    expect(await revokedAt(account.thisPhone.id)).toBeNull();
    expect(await sessionIds(account.userId)).toEqual([account.sessions.current]);
    expect(await sessionIds(other.userId)).toHaveLength(3);
    const group = await prisma.group.findUniqueOrThrow({ where: { id: account.groupId } });
    expect(group.epochRotationRequired).toBe(true);
    const otherGroup = await prisma.group.findUniqueOrThrow({ where: { id: other.groupId } });
    expect(otherGroup.epochRotationRequired).toBe(false);
    const devices = await callerFor(account).account.listDevices();
    expect(devices.map(({ id }) => id)).toEqual([account.thisPhone.id]);
  });

  test("sends the always-on device removed alert", async () => {
    const account = await createAccount();
    await prisma.user.update({
      where: { id: account.userId },
      data: { alertNewDevice: false, alertDeletionScheduled: false },
    });

    await callerFor(account).account.removeDevice({ deviceId: account.lostPhone.id });

    expect(await sentAlerts()).toEqual([
      {
        userId: account.userId,
        alert: {
          type: "device-removed",
          device: { name: "Lost phone", model: "Pixel 9", platform: "android" },
        },
      },
    ]);
  });

  test("refuses the current device", async () => {
    const account = await createAccount();

    await expect(
      callerFor(account).account.removeDevice({ deviceId: account.thisPhone.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerFor(account, { deviceId: "" }).account.removeDevice({
        deviceId: account.thisPhone.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(await revokedAt(account.thisPhone.id)).toBeNull();
    expect(await sessionIds(account.userId)).toHaveLength(3);
    expect(await sentAlerts()).toEqual([]);
  });

  test("refuses another account's device", async () => {
    const account = await createAccount();
    const other = await createAccount();

    await expect(
      callerFor(account).account.removeDevice({ deviceId: other.lostPhone.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await revokedAt(other.lostPhone.id)).toBeNull();
    expect(await sessionIds(other.userId)).toHaveLength(3);
  });

  test("needs a recent sign-in", async () => {
    const account = await createAccount();
    const stale = appRouter.createCaller({
      cache,
      db: prisma,
      emailCodes: null,
      securityAlerts,
      clientIp: `ip-${account.userId}`,
      deviceId: account.thisPhone.id,
      session: {
        user: { id: account.userId },
        session: { id: account.sessions.current, createdAt: new Date(0) },
      },
    } as Parameters<typeof appRouter.createCaller>[0]);

    await expect(
      stale.account.removeDevice({ deviceId: account.lostPhone.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await revokedAt(account.lostPhone.id)).toBeNull();
  });

  test("removes this phone and its session when signing out", async () => {
    const account = await createAccount();

    await callerFor(account).account.removeThisDevice();

    expect(await revokedAt(account.thisPhone.id)).toBeInstanceOf(Date);
    expect(await sessionIds(account.userId)).toEqual(
      [account.sessions.lost, account.sessions.unlinked].sort(),
    );
    expect((await sentAlerts()).map(({ alert }) => alert.type)).toEqual(["device-removed"]);
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("a removed device", () => {
  test("can't register again", async () => {
    const account = await createAccount();
    await callerFor(account).account.removeDevice({ deviceId: account.lostPhone.id });
    const removedAt = await revokedAt(account.lostPhone.id);

    const result = await tryCatch(
      upsertUserDevice({
        db: prisma,
        input: {
          algorithm: "X25519",
          deviceId: account.lostPhone.id,
          publicKey: account.lostPhone.publicKey,
        },
        securityAlerts: null,
        userId: account.userId,
      }),
    );

    expectDeviceRemoved(result.error);
    expect(await revokedAt(account.lostPhone.id)).toEqual(removedAt);
  });

  test("loses a new session that names it", async () => {
    const account = await createAccount();
    await callerFor(account).account.removeDevice({ deviceId: account.lostPhone.id });
    const signIn = await prisma.session.create({
      data: {
        id: `${prefix}-${crypto.randomUUID()}`,
        token: crypto.randomUUID(),
        userId: account.userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(
      await linkRequestDevice({
        db: prisma,
        deviceId: account.lostPhone.id,
        session: { id: signIn.id, userId: account.userId },
      }),
    ).toEqual({ removed: true });
    expect(await prisma.session.findUnique({ where: { id: signIn.id } })).toBeNull();
  });

  test("gets DEVICE_REMOVED on any request, so it can't upload or fetch wraps", async () => {
    const account = await createAccount();
    await callerFor(account).account.removeDevice({ deviceId: account.lostPhone.id });

    const result = await tryCatch(
      createTRPCContext({
        cache,
        db: prisma,
        headers: new Headers({ [deviceIdHeader]: account.lostPhone.id }),
        serverVersion: "test",
        serverName: "test",
        selfHosted: true,
      }),
    );

    expectDeviceRemoved(result.error);
  });

  test("tells the app why over HTTP", async () => {
    const account = await createAccount();
    await callerFor(account).account.removeDevice({ deviceId: account.lostPhone.id });
    const req = new Request("http://localhost/api/trpc/auth.providers", {
      headers: { [deviceIdHeader]: account.lostPhone.id },
    });

    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext: () =>
        createTRPCContext({
          cache,
          db: prisma,
          headers: req.headers,
          serverVersion: "test",
          serverName: "test",
          selfHosted: true,
        }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { json: { data: { code: "UNAUTHORIZED", cause: deviceRemovedCause } } },
    });
  });

  test("doesn't affect another account's session", async () => {
    const account = await createAccount();
    const other = await createAccount();
    await callerFor(account).account.removeDevice({ deviceId: account.lostPhone.id });

    expect(
      await linkRequestDevice({
        db: prisma,
        deviceId: account.lostPhone.id,
        session: { id: other.sessions.current, userId: other.userId },
      }),
    ).toEqual({ removed: false, deviceId: null });
    expect(await sessionIds(other.userId)).toHaveLength(3);
  });
});
