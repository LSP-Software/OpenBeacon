import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
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
  openSessionLinkChallenge,
  sealHistoryKeyEscrow,
} from "@openbeacon/encryption";
import { DevicePendingError } from "../lib/deviceActivation.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { accountHistoryRouter } from "./accountHistoryRouter.ts";
import { accountRecoveryRouter } from "./accountRecoveryRouter.ts";
import { authRouter } from "./authRouter.ts";
import { deviceRouter } from "./deviceRouter.ts";
import { groupInvitesRouter } from "./group/groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./group/groupLifecycleRouter.ts";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";

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

const caller = (
  userId: string,
  deviceId: string | null,
  securityAlerts: { send: (userId: string, alert: { type: string }) => void } | null = null,
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
        session: { id: `${userId}-session`, createdAt: new Date() },
      },
    }) as Parameters<typeof router.createCaller>[0],
  );

const register = (
  userId: string,
  deviceId: string,
  securityAlerts: Parameters<typeof caller>[2] = null,
) =>
  caller(userId, null, securityAlerts).auth.registerDeviceKey({
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

const resetFrom = async (api: ReturnType<typeof caller>, userId: string) => {
  const recoveryKey = deriveRecoveryKeyPair(generateRecoveryPhrase());
  const historyKey = createHistoryKeyPair();
  await api.accountRecovery.reset({
    confirmReset: true,
    historyKey: {
      algorithm: historyKey.algorithm,
      escrow: sealHistoryKeyEscrow({
        historyPrivateKey: historyKey.privateKey,
        recoveryPrivateKey: recoveryKey.privateKey,
        userId,
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
  return recoveryKey;
};

const removeDevices = (deviceIds: string[]) =>
  prisma.userDevice.updateMany({
    where: { id: { in: deviceIds } },
    data: { revokedAt: new Date() },
  });

const registerAfterRemoval = async (account: Awaited<ReturnType<typeof createAccount>>) => {
  const send = mock((_userId: string, _alert: { type: string }) => {});
  const device = await register(account.userId, `${account.userId}-after-removal`, { send });
  return { api: caller(account.userId, device.id), deviceId: device.id, send };
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
        accountHasActiveDevice: true,
        activated: false,
        registered: true,
      });
      expect(await caller(account.userId, account.firstDeviceId).device.status()).toEqual({
        accountHasActiveDevice: false,
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

    test("a session-link answer can't activate a Pending phone", async () => {
      const account = await createAccount("session-answer");
      const keyPair = createDeviceKeyPair();
      const device = await caller(account.userId, null).auth.registerDeviceKey({
        algorithm: "X25519",
        deviceId: `${account.userId}-keyed`,
        expectedUserId: account.userId,
        publicKey: keyPair.publicKey,
      });
      const linked = caller(account.userId, device.id);
      await linked.device.activationChallenge();

      const unlinkedSessionId = `${account.userId}-unlinked-session`;
      await prisma.session.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          id: unlinkedSessionId,
          token: `${unlinkedSessionId}-token`,
          userId: account.userId,
        },
      });
      const unlinked = router.createCaller(
        withDeviceActive({
          cache,
          db: prisma,
          clientIp: "127.0.0.1",
          deviceId: null,
          emailCodes: null,
          securityAlerts: null,
          session: {
            user: { id: account.userId },
            session: { id: unlinkedSessionId, createdAt: new Date() },
          },
        }) as Parameters<typeof router.createCaller>[0],
      );
      const challenge = await unlinked.device.sessionChallenge({ deviceId: device.id });
      if (challenge.linked) throw new Error("The session was already linked.");
      const sessionAnswer = openSessionLinkChallenge({
        deviceId: device.id,
        devicePrivateKey: keyPair.privateKey,
        sealed: challenge.sealed,
        userId: account.userId,
      });

      await expect(linked.device.activate({ answer: sessionAnswer })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This phone couldn't prove it holds your history key. Try again.",
      });
      expect(await deviceState(device.id)).toEqual({ activatedAt: null, activatedBy: null });
      expect(await rotationRequired(account.groupId)).toBe(false);
      expect(
        await prisma.deviceChallenge.findMany({
          select: { purpose: true, sessionId: true },
          where: { deviceId: device.id },
        }),
      ).toEqual([{ purpose: "sessionLink", sessionId: unlinkedSessionId }]);
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
      const devicePending = { code: "FORBIDDEN", cause: expect.any(DevicePendingError) };

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
      await prisma.deviceChallenge.updateMany({
        where: { deviceId: account.pendingDeviceId, purpose: "activation" },
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
      const devicePending = { code: "FORBIDDEN", cause: expect.any(DevicePendingError) };
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
      const recoveryKey = await resetFrom(account.pending, account.userId);
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

    test("a phone on an account that has never had an active phone is active straight away", async () => {
      const userId = `${prefix}-brand-new`;
      userIds.push(userId);
      await prisma.user.create({
        data: { id: userId, name: "new", email: `${userId}@example.test` },
      });
      const send = mock((_userId: string, _alert: { type: string }) => {});
      const device = await register(userId, `${userId}-phone`, { send });
      expect(await deviceState(device.id)).toEqual({
        activatedAt: expect.any(Date),
        activatedBy: "firstDevice",
      });
      expect(send).not.toHaveBeenCalled();
    });

    test("once every phone is removed, the next one is Pending, sends an alert and can use the phrase", async () => {
      const account = await createAccount("all-removed-phrase");
      await removeDevices([account.firstDeviceId, account.pendingDeviceId]);
      const next = await registerAfterRemoval(account);

      expect(await deviceState(next.deviceId)).toEqual({ activatedAt: null, activatedBy: null });
      expect(next.send.mock.calls).toEqual([
        [account.userId, expect.objectContaining({ type: "new-sign-in" })],
      ]);
      expect(await next.api.device.status()).toEqual({
        accountHasActiveDevice: false,
        activated: false,
        registered: true,
      });
      expect(await rotationRequired(account.groupId)).toBe(false);

      const challenge = await next.api.device.activationChallenge();
      await next.api.device.activate({
        answer: openDeviceActivationChallenge({
          deviceId: next.deviceId,
          historyPrivateKey: account.historyPrivateKey,
          sealed: challenge.sealed,
          userId: account.userId,
        }),
      });
      expect(await deviceState(next.deviceId)).toEqual({
        activatedAt: expect.any(Date),
        activatedBy: "phrase",
      });
    });

    test("once every phone is removed, the next one can be set up by starting fresh", async () => {
      const account = await createAccount("all-removed-reset");
      await removeDevices([account.firstDeviceId, account.pendingDeviceId]);
      const next = await registerAfterRemoval(account);
      expect((await deviceState(next.deviceId)).activatedAt).toBeNull();

      await resetFrom(next.api, account.userId);
      expect(await deviceState(next.deviceId)).toEqual({
        activatedAt: expect.any(Date),
        activatedBy: "reset",
      });
    });

    test("a Pending phone left on the account doesn't make the next one active", async () => {
      const account = await createAccount("pending-left");
      await removeDevices([account.firstDeviceId]);
      const next = await registerAfterRemoval(account);
      expect(await deviceState(next.deviceId)).toEqual({ activatedAt: null, activatedBy: null });
      expect(await next.api.device.status()).toMatchObject({ accountHasActiveDevice: false });
      expect(await account.pending.device.status()).toMatchObject({
        accountHasActiveDevice: false,
      });
    });

    test("status says whether another phone on the account is active", async () => {
      const account = await createAccount("other-active");
      const first = caller(account.userId, account.firstDeviceId);
      expect(await account.pending.device.status()).toMatchObject({ accountHasActiveDevice: true });
      expect(await first.device.status()).toMatchObject({ accountHasActiveDevice: false });

      const second = await register(account.userId, `${account.userId}-second`);
      await prisma.userDevice.update({
        where: { id: second.id },
        data: { activatedAt: new Date(), activatedBy: "link" },
      });
      expect(await first.device.status()).toMatchObject({ accountHasActiveDevice: true });

      await removeDevices([second.id]);
      expect(await first.device.status()).toMatchObject({ accountHasActiveDevice: false });
      await removeDevices([account.firstDeviceId]);
      expect(await account.pending.device.status()).toMatchObject({
        accountHasActiveDevice: false,
      });
    });

    test("status leaves out the phone a session names but hasn't proved", async () => {
      const account = await createAccount("unverified-status");
      const unverified = router.createCaller(
        withDeviceActive({
          cache,
          db: prisma,
          clientIp: "127.0.0.1",
          deviceId: null,
          unverifiedDeviceId: account.firstDeviceId,
          emailCodes: null,
          securityAlerts: null,
          session: {
            user: { id: account.userId },
            session: { id: `${account.userId}-unverified`, createdAt: new Date() },
          },
        }) as Parameters<typeof router.createCaller>[0],
      );
      expect(await unverified.device.status()).toEqual({
        accountHasActiveDevice: false,
        activated: false,
        registered: false,
      });
    });
  },
);
