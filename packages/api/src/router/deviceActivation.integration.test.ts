import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  deriveRecoveryKeyPair,
  encodeBase64,
  generateRecoveryPhrase,
  type HistoryPrivateKeyMaterial,
  openDeviceActivationChallenge,
  sealHistoryKeyEscrow,
} from "@openbeacon/encryption";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { accountHistoryRouter } from "./accountHistoryRouter.ts";
import { accountRecoveryRouter } from "./accountRecoveryRouter.ts";
import { authRouter } from "./authRouter.ts";
import { deviceRouter } from "./deviceRouter.ts";
import { groupInvitesRouter } from "./group/groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./group/groupLifecycleRouter.ts";

const router = createTRPCRouter({
  accountHistory: accountHistoryRouter,
  accountRecovery: accountRecoveryRouter,
  auth: authRouter,
  device: deviceRouter,
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `device-activation-${crypto.randomUUID()}`;
const userIds: string[] = [];

const caller = (userId: string, deviceId: string | null) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    deviceId,
    emailCodes: null,
    securityAlerts: null,
    session: {
      user: { id: userId },
      session: { id: `${userId}-session`, createdAt: new Date() },
    },
  } as Parameters<typeof router.createCaller>[0]);

const register = (userId: string, deviceId: string) =>
  caller(userId, null).auth.registerDeviceKey({
    algorithm: "X25519",
    deviceId,
    expectedUserId: userId,
    publicKey: createDeviceKeyPair().publicKey,
  });

const rotationRequired = async (groupId: string) =>
  (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).epochRotationRequired;

const createAccount = async (name: string) => {
  const userId = `${prefix}-${name}`;
  userIds.push(userId);
  const groupId = `${userId}-group`;
  await prisma.user.create({ data: { id: userId, name, email: `${userId}@example.test` } });
  const firstDevice = await register(userId, `${userId}-first`);
  await prisma.group.create({
    data: {
      id: groupId,
      name: "Family",
      groupMembers: { create: { userId, role: "OWNER", joinedEpochNumber: 1 } },
    },
  });
  const historyKey = createHistoryKeyPair();
  await caller(userId, firstDevice.id).accountHistory.create({
    algorithm: historyKey.algorithm,
    id: crypto.randomUUID(),
    publicKey: historyKey.publicKey,
  });
  const pendingDevice = await register(userId, `${userId}-pending`);
  return {
    firstDeviceId: firstDevice.id,
    groupId,
    historyPrivateKey: historyKey.privateKey,
    pending: caller(userId, pendingDevice.id),
    pendingDeviceId: pendingDevice.id,
    userId,
  };
};

const answer = async (
  account: Awaited<ReturnType<typeof createAccount>>,
  historyPrivateKey: HistoryPrivateKeyMaterial,
) => {
  const challenge = await account.pending.device.activationChallenge();
  return openDeviceActivationChallenge({
    deviceId: account.pendingDeviceId,
    historyPrivateKey,
    sealed: challenge.sealed,
    userId: account.userId,
  });
};

const deviceState = (deviceId: string) =>
  prisma.userDevice.findUniqueOrThrow({
    where: { id: deviceId },
    select: { activatedAt: true, activatedBy: true },
  });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "device activation with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: userIds.map((id) => `${id}-group`) } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.verification.deleteMany({
        where: { identifier: { startsWith: `device-activation:${prefix}` } },
      });
      await prisma.$disconnect();
    });

    test("the first device is active and a later one is Pending without flagging a rotation", async () => {
      const account = await createAccount("first");
      expect(await deviceState(account.firstDeviceId)).toEqual({
        activatedAt: expect.any(Date),
        activatedBy: "firstDevice",
      });
      expect(await deviceState(account.pendingDeviceId)).toEqual({
        activatedAt: null,
        activatedBy: null,
      });
      expect(await rotationRequired(account.groupId)).toBe(false);
      expect(await account.pending.device.status()).toEqual({
        activated: false,
        registered: true,
      });
      expect(await caller(account.userId, account.firstDeviceId).device.status()).toEqual({
        activated: true,
        registered: true,
      });
    });

    test("a Pending device can't create a History key", async () => {
      const account = await createAccount("no-create");
      await prisma.accountHistoryKey.deleteMany({ where: { userId: account.userId } });
      const historyKey = createHistoryKeyPair();
      await expect(
        account.pending.accountHistory.create({
          algorithm: historyKey.algorithm,
          id: crypto.randomUUID(),
          publicKey: historyKey.publicKey,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await prisma.accountHistoryKey.count({ where: { userId: account.userId } })).toBe(0);
    });

    test("the challenge only passes with the current History key and sets the rotation flag", async () => {
      const account = await createAccount("phrase");
      await expect(answer(account, createHistoryKeyPair().privateKey)).rejects.toThrow();
      await expect(
        account.pending.device.activate({
          answer: encodeBase64(globalThis.crypto.getRandomValues(new Uint8Array(32))),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await deviceState(account.pendingDeviceId)).activatedAt).toBeNull();

      const used = await answer(account, account.historyPrivateKey);
      await expect(
        account.pending.device.activate({ answer: encodeBase64(new Uint8Array(32)) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(account.pending.device.activate({ answer: used })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(await rotationRequired(account.groupId)).toBe(false);

      await account.pending.device.activate({
        answer: await answer(account, account.historyPrivateKey),
      });
      expect(await deviceState(account.pendingDeviceId)).toEqual({
        activatedAt: expect.any(Date),
        activatedBy: "phrase",
      });
      expect(await rotationRequired(account.groupId)).toBe(true);
    });

    test("activating again after a lost response says the phone is active", async () => {
      const account = await createAccount("retry");
      const opened = await answer(account, account.historyPrivateKey);
      await account.pending.device.activate({ answer: opened });
      const activated = await deviceState(account.pendingDeviceId);

      expect(await account.pending.device.activate({ answer: opened })).toEqual({
        activated: true,
      });
      expect(await deviceState(account.pendingDeviceId)).toEqual(activated);
    });

    test("a Pending device can't run group admin or owner actions or set up a phrase", async () => {
      const account = await createAccount("pending-admin");
      const devicePending = { code: "FORBIDDEN", message: expect.stringContaining("Set up") };

      await expect(
        account.pending.groupInvites.sharedStatuses({
          groupId: account.groupId,
          inviteIds: ["invite"],
        }),
      ).rejects.toMatchObject(devicePending);
      await expect(
        account.pending.groupLifecycle.delete({ groupId: account.groupId }),
      ).rejects.toMatchObject(devicePending);
      expect(await prisma.group.count({ where: { id: account.groupId } })).toBe(1);

      const phrase = generateRecoveryPhrase();
      const recoveryKey = deriveRecoveryKeyPair(phrase);
      const input = {
        escrows: [
          {
            ...sealHistoryKeyEscrow({
              historyPrivateKey: account.historyPrivateKey,
              recoveryPrivateKey: recoveryKey.privateKey,
              userId: account.userId,
              version: 1,
            }),
            version: 1,
          },
        ],
        recoveryKey: {
          algorithm: recoveryKey.algorithm,
          derivationVersion: recoveryKey.derivationVersion,
          publicKey: recoveryKey.publicKey,
        },
      };
      await expect(account.pending.accountRecovery.setup(input)).rejects.toMatchObject(
        devicePending,
      );
      await expect(account.pending.accountRecovery.changePhrase(input)).rejects.toMatchObject(
        devicePending,
      );
      expect(await prisma.recoveryKey.count({ where: { userId: account.userId } })).toBe(0);
    });

    test("an expired challenge fails", async () => {
      const account = await createAccount("expired");
      const opened = await answer(account, account.historyPrivateKey);
      await prisma.verification.updateMany({
        where: { identifier: `device-activation:${account.pendingDeviceId}` },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await expect(account.pending.device.activate({ answer: opened })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect((await deviceState(account.pendingDeviceId)).activatedAt).toBeNull();
    });

    test("a challenge fails once the History key has moved on", async () => {
      const account = await createAccount("moved-on");
      const opened = await answer(account, account.historyPrivateKey);
      const next = createHistoryKeyPair();
      await prisma.accountHistoryKey.create({
        data: {
          algorithm: next.algorithm,
          id: crypto.randomUUID(),
          publicKey: next.publicKey,
          userId: account.userId,
          version: 2,
        },
      });
      await expect(account.pending.device.activate({ answer: opened })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect((await deviceState(account.pendingDeviceId)).activatedAt).toBeNull();
    });

    test("an account with no History key gets no challenge", async () => {
      const account = await createAccount("no-key");
      await prisma.accountHistoryKey.deleteMany({ where: { userId: account.userId } });
      await expect(account.pending.device.activationChallenge()).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    test("a Pending device can't create or join a group", async () => {
      const host = await createAccount("join-host");
      const account = await createAccount("joiner");
      const devicePending = { code: "FORBIDDEN", message: expect.stringContaining("Set up") };
      const newGroupId = crypto.randomUUID();
      const keyPair = createDeviceKeyPair();
      const epoch = createInitialGroupEpoch({
        creator: { deviceId: account.pendingDeviceId, privateKey: keyPair.privateKey },
        groupId: newGroupId,
        recipients: [
          {
            algorithm: "X25519",
            createdAt: new Date(),
            deviceId: account.pendingDeviceId,
            publicKey: keyPair.publicKey,
            revokedAt: null,
            userId: account.userId,
          },
        ],
      });
      const nextEpoch = {
        createdByDeviceId: epoch.epoch.createdByDeviceId,
        epochId: epoch.epoch.epochId,
        epochNumber: epoch.epoch.epochNumber,
        historyKeys: [],
        recipientKeys: epoch.wrappedKeys,
      };
      const invite = await prisma.groupMemberInvite.create({
        data: {
          groupId: host.groupId,
          inviterId: host.userId,
          recipientId: account.userId,
          role: "MEMBER",
        },
      });
      const code = "A".repeat(32);
      await prisma.groupSharedInvite.create({
        data: {
          codeHash: createHash("sha256").update(code).digest("hex"),
          creatorId: host.userId,
          expiresAt: new Date(Date.now() + 60_000),
          groupId: host.groupId,
        },
      });

      await expect(
        account.pending.groupLifecycle.create({
          groupId: newGroupId,
          initialEpoch: nextEpoch,
          name: "Mine",
        }),
      ).rejects.toMatchObject(devicePending);
      await expect(
        account.pending.groupInvites.accept({ inviteId: invite.id, nextEpoch }),
      ).rejects.toMatchObject(devicePending);
      await expect(
        account.pending.groupInvites.acceptShared({ code, nextEpoch }),
      ).rejects.toMatchObject(devicePending);

      expect(await prisma.group.count({ where: { id: newGroupId } })).toBe(0);
      expect(await prisma.groupMember.count({ where: { userId: account.userId } })).toBe(1);
      expect(await prisma.groupMemberInvite.count({ where: { id: invite.id } })).toBe(1);
      expect(
        await prisma.groupSharedInvite.count({ where: { groupId: host.groupId, usedAt: null } }),
      ).toBe(1);
    });

    test("a reset with no phrase set up activates the Pending device that calls it", async () => {
      const account = await createAccount("reset");
      const phrase = generateRecoveryPhrase();
      const recoveryKey = deriveRecoveryKeyPair(phrase);
      const historyKey = createHistoryKeyPair();
      await account.pending.accountRecovery.reset({
        confirmReset: true,
        historyKey: {
          algorithm: historyKey.algorithm,
          escrow: sealHistoryKeyEscrow({
            historyPrivateKey: historyKey.privateKey,
            recoveryPrivateKey: recoveryKey.privateKey,
            userId: account.userId,
            version: 2,
          }),
          id: crypto.randomUUID(),
          publicKey: historyKey.publicKey,
          version: 2,
        },
        recoveryKey: {
          algorithm: recoveryKey.algorithm,
          derivationVersion: recoveryKey.derivationVersion,
          publicKey: recoveryKey.publicKey,
        },
      });
      expect(await deviceState(account.pendingDeviceId)).toEqual({
        activatedAt: expect.any(Date),
        activatedBy: "reset",
      });
      expect(await rotationRequired(account.groupId)).toBe(true);
      expect(await account.pending.accountRecovery.status()).toMatchObject({
        historyKeyVersions: [2],
        recoveryKey: { publicKey: recoveryKey.publicKey },
      });
    });
  },
);
