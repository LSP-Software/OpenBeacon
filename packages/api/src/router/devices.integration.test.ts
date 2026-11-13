import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { storedWebpResponse } from "../lib/storedWebp.testUtil.ts";
import { auth } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { createDeviceKeyPair, DEVICE_KEY_ALGORITHM } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { DevicePendingError } from "../lib/deviceActivation.ts";
import { DeviceUnverifiedError } from "../lib/deviceUnverified.ts";
import { buildUserAvatarPath, setPendingImageUploadForUser } from "../lib/image-upload.ts";
import { linkRequestDevice } from "../lib/requestDevice.ts";
import { appRouter } from "../root.ts";
import { s3Client } from "../s3client.ts";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";
import { env } from "../env.ts";

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

const callerFor = (
  account: Awaited<ReturnType<typeof createAccount>>,
  device: { deviceId: string | null; unverifiedDeviceId: string | null } = {
    deviceId: account.deviceId,
    unverifiedDeviceId: null,
  },
) =>
  appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      emailCodes: null,
      securityAlerts: null,
      clientIp: `ip-${account.userId}`,
      ...device,
      session: {
        user: { id: account.userId },
        session: { id: account.sessionId, createdAt: new Date() },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );

const link = async (account: Awaited<ReturnType<typeof createAccount>>, deviceId: string) => {
  const result = await linkRequestDevice({
    db: prisma,
    deviceId,
    session: { id: account.sessionId, userId: account.userId },
  });
  if (result.removed) return "removed";
  return result.unverifiedDeviceId ? `unverified:${result.unverifiedDeviceId}` : result.deviceId;
};

const linkSession = (account: Awaited<ReturnType<typeof createAccount>>) =>
  prisma.session.update({ where: { id: account.sessionId }, data: { deviceId: account.deviceId } });

const activate = (account: Awaited<ReturnType<typeof createAccount>>) =>
  prisma.userDevice.update({ where: { id: account.deviceId }, data: { activatedAt: new Date() } });

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("the device header", () => {
  test("never links a session by itself, and marks the phone it names as unverified", async () => {
    const account = await createAccount();

    expect(
      await Promise.all([link(account, account.deviceId), link(account, account.deviceId)]),
    ).toEqual([`unverified:${account.deviceId}`, `unverified:${account.deviceId}`]);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: account.sessionId } });
    expect(session.deviceId).toBeNull();
  });

  test("gives a linked session its device", async () => {
    const account = await createAccount();
    await linkSession(account);

    expect(await link(account, account.deviceId)).toBe(account.deviceId);
  });

  test("keeps a session's existing device and ignores another one it names", async () => {
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
    await linkSession(account);

    expect(await link(account, other.id)).toBeNull();
    expect(await link(account, account.deviceId)).toBe(account.deviceId);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: account.sessionId } });
    expect(session.deviceId).toBe(account.deviceId);

    await prisma.userDevice.update({ where: { id: other.id }, data: { revokedAt: new Date() } });
    expect(await link(account, other.id)).toBe("removed");
    expect(await prisma.session.findUnique({ where: { id: account.sessionId } })).toBeNull();
  });

  test("updates last active at most every 5 minutes", async () => {
    const account = await createAccount();
    const lastSeen = async () =>
      (await prisma.userDevice.findUniqueOrThrow({ where: { id: account.deviceId } })).lastSeenAt;
    const recent = await lastSeen();
    await linkSession(account);

    await link(account, account.deviceId);
    expect(await lastSeen()).toEqual(recent);

    await prisma.userDevice.update({
      where: { id: account.deviceId },
      data: { lastSeenAt: minutesAgo(6) },
    });
    await link(account, account.deviceId);
    expect((await lastSeen()).getTime()).toBeGreaterThan(minutesAgo(1).getTime());
  });

  test("doesn't mark a phone as active for a session it hasn't proved", async () => {
    const account = await createAccount();
    await prisma.userDevice.update({
      where: { id: account.deviceId },
      data: { lastSeenAt: minutesAgo(6) },
    });

    await link(account, account.deviceId);

    const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: account.deviceId } });
    expect(device.lastSeenAt.getTime()).toBeLessThan(minutesAgo(5).getTime());
  });

  test("registering a phone's key again doesn't mark it as active for a session that hasn't proved it", async () => {
    const account = await createAccount();
    const keyPair = createDeviceKeyPair();
    const lost = await prisma.userDevice.create({
      data: {
        activatedAt: new Date(),
        icon: "phone",
        id: `${account.deviceId}-lost`,
        lastSeenAt: minutesAgo(60),
        name: "Lost phone",
        publicKey: keyPair.publicKey,
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        userId: account.userId,
      },
    });

    const registered = await callerFor(account, {
      deviceId: null,
      unverifiedDeviceId: null,
    }).auth.registerDeviceKey({
      algorithm: DEVICE_KEY_ALGORITHM,
      deviceId: lost.id,
      expectedUserId: account.userId,
      publicKey: keyPair.publicKey,
    });

    expect(registered.sessionLinked).toBe(false);
    const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: lost.id } });
    expect(device.lastSeenAt.getTime()).toBeLessThan(minutesAgo(59).getTime());
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

  test("a removed Pending phone whose record was cleaned up signs in again as a new Pending phone", async () => {
    const account = await createAccount();
    await prisma.userDevice.update({
      where: { id: account.deviceId },
      data: { activatedAt: new Date() },
    });
    const keyPair = createDeviceKeyPair();
    const phoneId = `${account.deviceId}-cleaned`;
    await prisma.userDevice.create({
      data: {
        icon: "phone",
        id: phoneId,
        name: "Removed phone",
        publicKey: keyPair.publicKey,
        publicKeyAlgorithm: DEVICE_KEY_ALGORITHM,
        revokedAt: new Date(),
        userId: account.userId,
      },
    });
    expect(await linkRequestDevice({ db: prisma, deviceId: phoneId, session: null })).toEqual({
      removed: true,
    });

    await prisma.userDevice.delete({ where: { id: phoneId } });
    expect(await linkRequestDevice({ db: prisma, deviceId: phoneId, session: null })).toEqual({
      removed: false,
      deviceId: null,
      unverifiedDeviceId: null,
      deviceActive: false,
    });

    const session = await prisma.session.create({
      data: {
        expiresAt: new Date(Date.now() + 60 * 60_000),
        id: `${phoneId}-session`,
        token: `${phoneId}-token`,
        userId: account.userId,
      },
    });
    const phone = { ...account, sessionId: session.id };
    expect(await link(phone, phoneId)).toBeNull();
    const registered = await callerFor(phone, {
      deviceId: null,
      unverifiedDeviceId: null,
    }).auth.registerDeviceKey({
      algorithm: DEVICE_KEY_ALGORITHM,
      deviceId: phoneId,
      expectedUserId: account.userId,
      publicKey: keyPair.publicKey,
    });

    expect(registered).toMatchObject({ id: phoneId, activatedAt: null, revokedAt: null });
    expect(registered.sessionLinked).toBe(true);
    expect(await link(phone, phoneId)).toBe(phoneId);
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
    await activate(account);

    const devices = await callerFor(account).account.listDevices();

    expect(devices.map(({ id, name, isCurrent }) => ({ id, name, isCurrent }))).toEqual([
      { id: account.deviceId, name: "Pixel 9", isCurrent: true },
      { id: `${account.deviceId}-tablet`, name: "iPad", isCurrent: false },
    ]);
  });

  test("renames a device and changes its icon", async () => {
    const account = await createAccount();
    await activate(account);

    await callerFor(account).account.updateDevice({
      deviceId: account.deviceId,
      name: "  Car tablet ",
      icon: "car",
    });

    const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: account.deviceId } });
    expect(device).toMatchObject({ name: "Car tablet", icon: "car" });
  });

  test("persists the new device identifiers and returns them in the device list", async () => {
    const account = await createAccount();
    await activate(account);
    const caller = callerFor(account);

    for (const icon of [
      "phoneClassic",
      "tabletPortrait",
      "star",
      "heart",
      "flower",
      "sun",
    ] as const) {
      await caller.account.updateDevice({ deviceId: account.deviceId, icon });
      const devices = await caller.account.listDevices();
      expect(devices.find(({ id }) => id === account.deviceId)?.icon).toBe(icon);
    }
  });

  test("rejects another account's device", async () => {
    const account = await createAccount();
    const other = await createAccount();
    await activate(account);

    await expect(
      callerFor(account).account.updateDevice({ deviceId: other.deviceId, name: "Mine now" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: other.deviceId } });
    expect(device.name).toBe("Pixel 9");
  });

  test("a phone that isn't set up can't list or name any phone", async () => {
    const account = await createAccount();
    await linkSession(account);
    const other = await prisma.userDevice.create({
      data: {
        activatedAt: new Date(),
        icon: "phone",
        id: `${account.deviceId}-other`,
        name: "Other phone",
        publicKey: "key",
        publicKeyAlgorithm: "x25519",
        userId: account.userId,
      },
    });

    for (const [device, cause] of [
      [{ deviceId: account.deviceId, unverifiedDeviceId: null }, DevicePendingError],
      [{ deviceId: null, unverifiedDeviceId: other.id }, DeviceUnverifiedError],
    ] as const) {
      const caller = callerFor(account, device);
      for (const call of [
        () => caller.account.listDevices(),
        () => caller.account.updateDevice({ deviceId: account.deviceId, name: "Mine" }),
        () => caller.account.updateDevice({ deviceId: other.id, name: "Taken" }),
      ]) {
        const result = await tryCatch(call());
        expect(result.error).toMatchObject({ code: "FORBIDDEN" });
        expect((result.error as { cause?: unknown }).cause).toBeInstanceOf(cause);
      }
    }

    expect(
      (await prisma.userDevice.findUniqueOrThrow({ where: { id: account.deviceId } })).name,
    ).toBe("Pixel 9");
    expect((await prisma.userDevice.findUniqueOrThrow({ where: { id: other.id } })).name).toBe(
      "Other phone",
    );
  });

  test("rejects bad names", async () => {
    const account = await createAccount();
    await activate(account);

    for (const name of ["   ", "a".repeat(41), "Car\nKeys"]) {
      await expect(
        callerFor(account).account.updateDevice({ deviceId: account.deviceId, name }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("account profile", () => {
  const contentHash = `${"a".repeat(43)}=`;

  test("only an active phone can change the name and photo other members see", async () => {
    const account = await createAccount();
    await linkSession(account);

    for (const [device, cause] of [
      [{ deviceId: account.deviceId, unverifiedDeviceId: null }, DevicePendingError],
      [{ deviceId: null, unverifiedDeviceId: account.deviceId }, DeviceUnverifiedError],
    ] as const) {
      const caller = callerFor(account, device);
      for (const call of [
        () => caller.account.updateName({ name: "Someone else" }),
        () => caller.account.requestProfileImageUpload({ contentHash, fileSize: 100 }),
        () => caller.account.confirmProfileImageUpload(),
      ]) {
        const result = await tryCatch(call());
        expect(result.error).toMatchObject({ code: "FORBIDDEN" });
        expect((result.error as { cause?: unknown }).cause).toBeInstanceOf(cause);
      }
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: account.userId } })).name).toBe(
      "Devices Test",
    );
    expect(await prisma.pendingUpload.findFirst({ where: { userId: account.userId } })).toBeNull();

    await prisma.userDevice.update({
      where: { id: account.deviceId },
      data: { activatedAt: new Date() },
    });

    expect(await callerFor(account).account.updateName({ name: "New name" })).toEqual({
      name: "New name",
    });
    await callerFor(account).account.requestProfileImageUpload({ contentHash, fileSize: 100 });
    expect(
      await prisma.pendingUpload.findFirst({ where: { userId: account.userId } }),
    ).not.toBeNull();
  });

  test("a newer upload request racing a confirm keeps the older file off the profile", async () => {
    const account = await createAccount();
    await activate(account);
    const pendingUpload = (fileName: string) =>
      setPendingImageUploadForUser({
        db: prisma,
        userId: account.userId,
        uploadType: "userAvatar",
        fileName,
        bucketName: env.S3_BUCKET_NAME,
        currentImagePath: buildUserAvatarPath(account.userId),
      });
    await pendingUpload("old.webp");
    const send = spyOn(s3Client, "send").mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) await pendingUpload("new.webp");
      return storedWebpResponse(command);
    });
    try {
      await expect(callerFor(account).account.confirmProfileImageUpload()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "No pending profile image upload to confirm.",
      });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.userId } })).image,
      ).toBeNull();
      expect(
        (await prisma.pendingUpload.findMany({ where: { userId: account.userId } })).map(
          ({ fileName }) => fileName,
        ),
      ).toEqual(["new.webp"]);
    } finally {
      send.mockRestore();
    }
  });
});
