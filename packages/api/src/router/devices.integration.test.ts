import { afterAll, describe, expect, test } from "bun:test";
import { auth } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { linkRequestDevice } from "../lib/requestDevice.ts";
import { appRouter } from "../root.ts";

const prefix = `devices-${crypto.randomUUID()}`;
const password = "testing-password-123";
const cache = createIntegrationTestCache(() => 0);
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

let accountCounter = 0;
const createAccount = async () => {
  accountCounter += 1;
  const email = `${prefix}-${accountCounter}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { email, password, name: "Devices Test" } });
  const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  const device = await prisma.userDevice.create({
    data: {
      id: `${prefix}-device-${crypto.randomUUID()}`,
      userId: user.id,
      publicKey: "key",
      publicKeyAlgorithm: "x25519",
      model: "Pixel 9",
      name: "Pixel 9",
      icon: "phone",
      lastSeenAt: minutesAgo(1),
    },
  });
  return { userId: user.id, sessionId: session.id, deviceId: device.id };
};

const callerFor = (account: Awaited<ReturnType<typeof createAccount>>) =>
  appRouter.createCaller({
    cache,
    db: prisma,
    emailCodes: null,
    securityAlerts: null,
    clientIp: `ip-${account.userId}`,
    deviceId: account.deviceId,
    session: {
      user: { id: account.userId },
      session: { id: account.sessionId, createdAt: new Date() },
    },
  } as Parameters<typeof appRouter.createCaller>[0]);

const link = (account: Awaited<ReturnType<typeof createAccount>>, deviceId: string) =>
  linkRequestDevice({
    db: prisma,
    deviceId,
    sessionId: account.sessionId,
    userId: account.userId,
  });

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("the device header", () => {
  test("links the session to the device", async () => {
    const account = await createAccount();

    expect(await link(account, account.deviceId)).toBe(account.deviceId);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: account.sessionId } });
    expect(session.deviceId).toBe(account.deviceId);
  });

  test("keeps a session's existing device", async () => {
    const account = await createAccount();
    const other = await prisma.userDevice.create({
      data: {
        id: `${account.deviceId}-other`,
        userId: account.userId,
        publicKey: "key",
        publicKeyAlgorithm: "x25519",
        name: "Tablet",
        icon: "tablet",
      },
    });
    await link(account, account.deviceId);

    expect(await link(account, other.id)).toBe(other.id);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: account.sessionId } });
    expect(session.deviceId).toBe(account.deviceId);
  });

  test("updates last active at most every 5 minutes", async () => {
    const account = await createAccount();
    const lastSeen = async () =>
      (await prisma.userDevice.findUniqueOrThrow({ where: { id: account.deviceId } })).lastSeenAt;
    const recent = await lastSeen();

    await link(account, account.deviceId);
    expect(await lastSeen()).toEqual(recent);

    await prisma.userDevice.update({
      where: { id: account.deviceId },
      data: { lastSeenAt: minutesAgo(6) },
    });
    await link(account, account.deviceId);
    expect((await lastSeen()).getTime()).toBeGreaterThan(minutesAgo(1).getTime());
  });

  test("ignores another account's device and unknown ids", async () => {
    const account = await createAccount();
    const other = await createAccount();
    await prisma.userDevice.update({
      where: { id: other.deviceId },
      data: { lastSeenAt: minutesAgo(10) },
    });

    expect(await link(account, other.deviceId)).toBeNull();
    expect(await link(account, `${prefix}-unknown`)).toBeNull();

    const session = await prisma.session.findUniqueOrThrow({ where: { id: account.sessionId } });
    expect(session.deviceId).toBeNull();
    const otherDevice = await prisma.userDevice.findUniqueOrThrow({
      where: { id: other.deviceId },
    });
    expect(otherDevice.lastSeenAt.getTime()).toBeLessThan(minutesAgo(9).getTime());
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("account devices", () => {
  test("lists the account's devices and marks the current one", async () => {
    const account = await createAccount();
    await prisma.userDevice.create({
      data: {
        id: `${account.deviceId}-revoked`,
        userId: account.userId,
        publicKey: "key",
        publicKeyAlgorithm: "x25519",
        name: "Old phone",
        icon: "phone",
        revokedAt: new Date(),
      },
    });
    await prisma.userDevice.create({
      data: {
        id: `${account.deviceId}-tablet`,
        userId: account.userId,
        publicKey: "key",
        publicKeyAlgorithm: "x25519",
        name: "iPad",
        icon: "tablet",
      },
    });

    const devices = await callerFor(account).account.listDevices();

    expect(devices.map(({ id, name, isCurrent }) => ({ id, name, isCurrent }))).toEqual([
      { id: account.deviceId, name: "Pixel 9", isCurrent: true },
      { id: `${account.deviceId}-tablet`, name: "iPad", isCurrent: false },
    ]);
  });

  test("renames a device and changes its icon", async () => {
    const account = await createAccount();

    await callerFor(account).account.updateDevice({
      deviceId: account.deviceId,
      name: "  Car tablet ",
      icon: "car",
    });

    const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: account.deviceId } });
    expect(device).toMatchObject({ name: "Car tablet", icon: "car" });
  });

  test("rejects another account's device", async () => {
    const account = await createAccount();
    const other = await createAccount();

    await expect(
      callerFor(account).account.updateDevice({ deviceId: other.deviceId, name: "Mine now" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: other.deviceId } });
    expect(device.name).toBe("Pixel 9");
  });

  test("rejects bad names", async () => {
    const account = await createAccount();

    for (const name of ["   ", "a".repeat(41), "Car\nKeys"]) {
      await expect(
        callerFor(account).account.updateDevice({ deviceId: account.deviceId, name }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});
