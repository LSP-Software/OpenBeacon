import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSecurityAlerts } from "@openbeacon/auth";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import type { SecurityAlert } from "@openbeacon/email";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  encodeBase64,
  openDeviceLinkHandover,
  sealDeviceLinkHandover,
} from "@openbeacon/encryption";
import { holdRowLock } from "../lib/databaseLocks.testUtil.ts";
import { DevicePendingError } from "../lib/deviceActivation.ts";
import { linkRequestDevice } from "../lib/requestDevice.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { accountHistoryRouter } from "./accountHistoryRouter.ts";
import { accountRouter } from "./accountRouter.ts";
import { authRouter } from "./authRouter.ts";
import { deviceLinkRouter } from "./deviceLinkRouter.ts";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";

const router = createTRPCRouter({
  account: accountRouter,
  accountHistory: accountHistoryRouter,
  auth: authRouter,
  deviceLink: deviceLinkRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `device-link-${crypto.randomUUID()}`;
const userIds: string[] = [];
const sentAlerts: { userId: string; alert: SecurityAlert }[] = [];
const alertTasks: Promise<unknown>[] = [];
const securityAlerts = createSecurityAlerts({
  db: prisma,
  sendSecurityAlertEmail: async ({ userId, alert }) => {
    sentAlerts.push({ userId, alert });
  },
  runInBackground: (task) => alertTasks.push(task),
});

const caller = (
  userId: string,
  deviceId: string | null,
  sessionId = `${userId}-${deviceId}-session`,
) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      emailCodes: null,
      securityAlerts,
      session: {
        user: { id: userId },
        session: { id: sessionId, createdAt: new Date() },
      },
    }) as Parameters<typeof router.createCaller>[0],
  );

const register = async (userId: string, name: string) => {
  const keyPair = createDeviceKeyPair();
  const device = await caller(userId, null).auth.registerDeviceKey({
    algorithm: "X25519",
    deviceId: `${userId}-${name}`,
    expectedUserId: userId,
    publicKey: keyPair.publicKey,
  });
  await prisma.session.create({
    data: {
      deviceId: device.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      id: `${userId}-${device.id}-session`,
      token: `${userId}-${device.id}-token`,
      userId,
    },
  });
  return { ...keyPair, api: caller(userId, device.id), deviceId: device.id };
};

const createAccount = async (name: string) => {
  const userId = `${prefix}-${name}`;
  userIds.push(userId);
  const groupId = `${userId}-group`;
  await prisma.user.create({ data: { id: userId, name, email: `${userId}@example.test` } });
  const active = await register(userId, "active");
  await prisma.group.create({
    data: {
      id: groupId,
      name: "Family",
      groupMembers: { create: { userId, role: "OWNER", joinedEpochNumber: 1 } },
    },
  });
  const historyKey = createHistoryKeyPair();
  await active.api.accountHistory.create({
    algorithm: historyKey.algorithm,
    id: crypto.randomUUID(),
    publicKey: historyKey.publicKey,
  });
  await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });
  const pending = await register(userId, "pending");
  return { active, groupId, historyKey, pending, userId };
};

const sealFor = (
  account: Awaited<ReturnType<typeof createAccount>>,
  linkId: string,
  psk: Uint8Array,
) =>
  sealDeviceLinkHandover({
    approverPrivateKey: account.active.privateKey,
    historyKeys: [{ privateKey: account.historyKey.privateKey, version: 1 }],
    linkId,
    newDeviceId: account.pending.deviceId,
    newDevicePublicKey: account.pending.publicKey,
    psk,
    userId: account.userId,
  });

const deviceState = (deviceId: string) =>
  prisma.userDevice.findUniqueOrThrow({
    where: { id: deviceId },
    select: { activatedAt: true, activatedBy: true, revokedAt: true },
  });

const rotationRequired = async (groupId: string) =>
  (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).epochRotationRequired;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "device links with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: userIds.map((id) => `${id}-group`) } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    });

    test("an active device approves a link, which activates the new device with its history", async () => {
      const account = await createAccount("approve");
      const psk = createDeviceLinkSecret();
      const { linkId } = await account.pending.api.deviceLink.create();
      expect(await account.pending.api.deviceLink.status({ linkId })).toMatchObject({
        state: "waiting",
      });

      expect(await account.active.api.deviceLink.get({ linkId })).toMatchObject({
        deviceId: account.pending.deviceId,
        name: expect.any(String),
        publicKey: account.pending.publicKey,
      });
      expect(await rotationRequired(account.groupId)).toBe(false);

      await account.active.api.deviceLink.approve({ linkId, ...sealFor(account, linkId, psk) });
      expect(await deviceState(account.pending.deviceId)).toMatchObject({
        activatedAt: expect.any(Date),
        activatedBy: "link",
      });
      expect(await rotationRequired(account.groupId)).toBe(true);

      const status = await account.pending.api.deviceLink.status({ linkId });
      if (status.state !== "approved") throw new Error("The link wasn't approved.");
      expect(status.approverPublicKey).toBe(account.active.publicKey);
      const opened = openDeviceLinkHandover({
        approverPublicKey: status.approverPublicKey,
        currentHistoryKeyVersion: 1,
        devicePrivateKey: account.pending.privateKey,
        linkId,
        newDeviceId: account.pending.deviceId,
        psk,
        publishedHistoryKeys: [{ publicKey: account.historyKey.publicKey, version: 1 }],
        sealed: status,
        userId: account.userId,
      });
      expect(encodeBase64(opened[0]?.privateKey.expose() ?? new Uint8Array())).toBe(
        encodeBase64(account.historyKey.privateKey.expose()),
      );

      await expect(account.active.api.deviceLink.get({ linkId })).rejects.toMatchObject({
        cause: { reason: "ALREADY_SET_UP" },
        code: "CONFLICT",
      });
      await expect(
        account.active.api.deviceLink.approve({ linkId, ...sealFor(account, linkId, psk) }),
      ).rejects.toMatchObject({ code: "CONFLICT", cause: { reason: "ALREADY_SET_UP" } });
    });

    test("only an active device of the same account can get or approve a link", async () => {
      const account = await createAccount("owner");
      const stranger = await createAccount("stranger");
      const otherPending = await register(account.userId, "other-pending");
      const { linkId } = await account.pending.api.deviceLink.create();
      const sealed = sealFor(account, linkId, createDeviceLinkSecret());

      for (const api of [otherPending.api, account.pending.api]) {
        await expect(api.deviceLink.get({ linkId })).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(api.deviceLink.approve({ linkId, ...sealed })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
      await expect(stranger.active.api.deviceLink.get({ linkId })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "This code is for a different account.",
      });
      await expect(
        stranger.active.api.deviceLink.approve({ linkId, ...sealed }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect((await deviceState(account.pending.deviceId)).activatedAt).toBeNull();
      expect(await rotationRequired(account.groupId)).toBe(false);
    });

    test("an expired link is refused", async () => {
      const account = await createAccount("expired");
      const { linkId } = await account.pending.api.deviceLink.create();
      await prisma.deviceLink.update({
        where: { id: linkId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await expect(account.active.api.deviceLink.get({ linkId })).rejects.toMatchObject({
        cause: { reason: "CODE_EXPIRED" },
        code: "BAD_REQUEST",
      });
      await expect(
        account.active.api.deviceLink.approve({
          linkId,
          ...sealFor(account, linkId, createDeviceLinkSecret()),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", cause: { reason: "CODE_EXPIRED" } });
      expect(await account.pending.api.deviceLink.status({ linkId })).toMatchObject({
        state: "expired",
      });
      expect((await deviceState(account.pending.deviceId)).activatedAt).toBeNull();
    });

    test("the new device can't fetch the handover for someone else's link", async () => {
      const account = await createAccount("fetch");
      const stranger = await createAccount("fetch-stranger");
      const otherPending = await register(account.userId, "fetch-other");
      const psk = createDeviceLinkSecret();
      const { linkId } = await account.pending.api.deviceLink.create();
      await account.active.api.deviceLink.approve({ linkId, ...sealFor(account, linkId, psk) });

      await expect(otherPending.api.deviceLink.status({ linkId })).rejects.toMatchObject({
        cause: { reason: "CODE_EXPIRED" },
        code: "NOT_FOUND",
      });
      await expect(stranger.pending.api.deviceLink.status({ linkId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(stranger.active.api.deviceLink.status({ linkId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    test("a Pending device has one link at a time and an active device can't make one", async () => {
      const account = await createAccount("one-link");
      const first = await account.pending.api.deviceLink.create();
      const second = await account.pending.api.deviceLink.create();
      expect(second.linkId).not.toBe(first.linkId);
      expect(
        await prisma.deviceLink.findMany({
          where: { deviceId: account.pending.deviceId },
          select: { id: true },
        }),
      ).toEqual([{ id: second.linkId }]);
      await expect(
        account.active.api.deviceLink.get({ linkId: first.linkId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", cause: { reason: "CODE_EXPIRED" } });
      await expect(account.active.api.deviceLink.create()).rejects.toMatchObject({
        cause: { reason: "ALREADY_SET_UP" },
        code: "CONFLICT",
      });
    });

    test("a Pending device can't make a link when no other phone on the account is active", async () => {
      const account = await createAccount("no-approver");
      await prisma.userDevice.update({
        where: { id: account.active.deviceId },
        data: { revokedAt: new Date() },
      });
      const other = await register(account.userId, "other-pending");

      await expect(account.pending.api.deviceLink.create()).rejects.toMatchObject({
        cause: { reason: "NO_APPROVING_DEVICE" },
        code: "PRECONDITION_FAILED",
      });
      await expect(other.api.deviceLink.create()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await prisma.deviceLink.count({ where: { userId: account.userId } })).toBe(0);
    });

    test("declining removes the Pending device and its link", async () => {
      const account = await createAccount("decline");
      const { linkId } = await account.pending.api.deviceLink.create();
      await expect(account.pending.api.deviceLink.decline({ linkId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      await account.active.api.deviceLink.decline({ linkId });
      expect((await deviceState(account.pending.deviceId)).revokedAt).toEqual(expect.any(Date));
      expect(await prisma.deviceLink.count({ where: { id: linkId } })).toBe(0);
      expect(await prisma.session.count({ where: { deviceId: account.pending.deviceId } })).toBe(0);
      await expect(account.active.api.deviceLink.decline({ linkId })).rejects.toMatchObject({
        cause: { reason: "CODE_EXPIRED" },
        code: "NOT_FOUND",
      });
      while (alertTasks.length) await Promise.all(alertTasks.splice(0));
      expect(sentAlerts).toContainEqual({
        userId: account.userId,
        alert: expect.objectContaining({ type: "device-removed" }),
      });
    });

    test("declining refuses a phone that was approved while the decline waited", async () => {
      const account = await createAccount("decline-race");
      const { linkId } = await account.pending.api.deviceLink.create();
      const lock = await holdRowLock({ db: prisma, id: account.userId, table: "User" });
      const declining = account.active.api.deviceLink.decline({ linkId });
      await lock.waitForWaiters(1);
      await prisma.deviceLink.update({
        where: { id: linkId },
        data: {
          approverDeviceId: account.active.deviceId,
          ciphertext: "handover",
          completedAt: new Date(),
          enc: "enc",
        },
      });
      await prisma.userDevice.update({
        where: { id: account.pending.deviceId },
        data: { activatedAt: new Date(), activatedBy: "link" },
      });
      await lock.release();

      await expect(declining).rejects.toMatchObject({
        cause: { reason: "ALREADY_SET_UP" },
        code: "CONFLICT",
        message:
          "This phone has already been set up. Remove it from your devices if it isn't yours.",
      });
      expect(await deviceState(account.pending.deviceId)).toMatchObject({
        activatedAt: expect.any(Date),
        revokedAt: null,
      });
      expect(await prisma.session.count({ where: { deviceId: account.pending.deviceId } })).toBe(1);
    });

    test("a Pending device's session can't act as an active device by naming it", async () => {
      const account = await createAccount("spoof");
      const { linkId } = await account.pending.api.deviceLink.create();
      const pendingSessionId = `${account.userId}-${account.pending.deviceId}-session`;
      const named = await linkRequestDevice({
        db: prisma,
        deviceId: account.active.deviceId,
        session: { id: pendingSessionId, userId: account.userId },
      });
      expect(named).toEqual({
        removed: false,
        deviceId: null,
        unverifiedDeviceId: null,
        deviceActive: false,
      });
      const spoofed = caller(
        account.userId,
        named.removed ? null : named.deviceId,
        pendingSessionId,
      );

      await expect(
        spoofed.deviceLink.approve({
          linkId,
          ...sealFor(account, linkId, createDeviceLinkSecret()),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(spoofed.account.removeThisDevice()).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await deviceState(account.pending.deviceId)).activatedAt).toBeNull();
      expect((await deviceState(account.active.deviceId)).revokedAt).toBeNull();
    });

    test("a Pending device with a fresh session can't remove an active device", async () => {
      const account = await createAccount("pending-remove");
      await expect(
        account.pending.api.account.removeDevice({ deviceId: account.active.deviceId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await deviceState(account.active.deviceId)).revokedAt).toBeNull();
    });

    test("an approver removed while its approval waits can't approve", async () => {
      const account = await createAccount("approver-removed");
      const { linkId } = await account.pending.api.deviceLink.create();
      const sealed = sealFor(account, linkId, createDeviceLinkSecret());
      const lock = await holdRowLock({ db: prisma, id: account.userId, table: "User" });
      const approval = account.active.api.deviceLink.approve({ linkId, ...sealed });
      await lock.waitForWaiters(1);
      await prisma.userDevice.update({
        where: { id: account.active.deviceId },
        data: { revokedAt: new Date() },
      });
      await lock.release();

      const refused = await approval.catch((error: unknown) => error);
      expect(refused).toMatchObject({ code: "FORBIDDEN" });
      expect((refused as { cause?: unknown }).cause).toBeInstanceOf(DevicePendingError);
      expect((await deviceState(account.pending.deviceId)).activatedAt).toBeNull();
      expect(
        await prisma.deviceLink.findUniqueOrThrow({
          where: { id: linkId },
          select: { completedAt: true },
        }),
      ).toEqual({ completedAt: null });
    });

    test("a new link made while an approval lands keeps the approved handover", async () => {
      const account = await createAccount("create-race");
      const { linkId } = await account.pending.api.deviceLink.create();
      const lock = await holdRowLock({ db: prisma, id: account.userId, table: "User" });
      const creating = account.pending.api.deviceLink.create();
      await lock.waitForWaiters(1);
      await prisma.deviceLink.update({
        where: { id: linkId },
        data: {
          approverDeviceId: account.active.deviceId,
          ciphertext: "handover",
          completedAt: new Date(),
          enc: "enc",
        },
      });
      await prisma.userDevice.update({
        where: { id: account.pending.deviceId },
        data: { activatedAt: new Date(), activatedBy: "link" },
      });
      await lock.release();

      await expect(creating).rejects.toMatchObject({
        code: "CONFLICT",
        cause: { reason: "ALREADY_SET_UP" },
      });
      expect(await account.pending.api.deviceLink.status({ linkId })).toMatchObject({
        ciphertext: "handover",
        state: "approved",
      });
    });

    test("removing a device deletes its own links but keeps a handover it approved", async () => {
      const account = await createAccount("remove");
      const second = await register(account.userId, "second");
      await prisma.userDevice.update({
        where: { id: second.deviceId },
        data: { activatedAt: new Date(), activatedBy: "existing" },
      });
      const { linkId } = await account.pending.api.deviceLink.create();
      await account.active.api.account.removeDevice({ deviceId: account.pending.deviceId });
      expect(await prisma.deviceLink.count({ where: { id: linkId } })).toBe(0);

      const later = await register(account.userId, "later");
      const approved = await later.api.deviceLink.create();
      await second.api.deviceLink.approve({
        linkId: approved.linkId,
        ...sealDeviceLinkHandover({
          approverPrivateKey: second.privateKey,
          historyKeys: [{ privateKey: account.historyKey.privateKey, version: 1 }],
          linkId: approved.linkId,
          newDeviceId: later.deviceId,
          newDevicePublicKey: later.publicKey,
          psk: createDeviceLinkSecret(),
          userId: account.userId,
        }),
      });
      await account.active.api.account.removeDevice({ deviceId: second.deviceId });
      expect(await later.api.deviceLink.status({ linkId: approved.linkId })).toMatchObject({
        approverPublicKey: second.publicKey,
        state: "approved",
      });
    });

    test("deleting the account deletes its links", async () => {
      const account = await createAccount("delete");
      const { linkId } = await account.pending.api.deviceLink.create();
      await prisma.group.deleteMany({ where: { id: account.groupId } });
      await prisma.user.delete({ where: { id: account.userId } });
      expect(await prisma.deviceLink.count({ where: { id: linkId } })).toBe(0);
    });
  },
);
