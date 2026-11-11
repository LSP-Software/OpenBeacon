import { afterAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  deriveRecoveryKeyPair,
  generateRecoveryPhrase,
  openDeviceActivationChallenge,
  sealHistoryKeyEscrow,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { DevicePendingError } from "../lib/deviceActivation.ts";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";
import { appRouter } from "../root.ts";

const cache = createIntegrationTestCache(() => 0);
const prefix = `pending-device-${crypto.randomUUID()}`;
const userIds: string[] = [];

const caller = (userId: string, deviceId: string | null) =>
  appRouter.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: `ip-${userId}`,
      deviceId,
      emailCodes: null,
      securityAlerts: null,
      serverVersion: "9.9.9",
      serverName: "Test server",
      selfHosted: true,
      session: {
        user: { id: userId, email: `${userId}@example.test` },
        session: { id: `${userId}-session`, createdAt: new Date() },
      },
    }) as Parameters<typeof appRouter.createCaller>[0],
  );

const register = async (userId: string, deviceId: string) =>
  (
    await caller(userId, null).auth.registerDeviceKey({
      algorithm: "X25519",
      deviceId,
      expectedUserId: userId,
      publicKey: createDeviceKeyPair().publicKey,
    })
  ).id;

const createAccount = async (name: string, { withActivePhone = true } = {}) => {
  const userId = `${prefix}-${name}`;
  userIds.push(userId);
  await prisma.user.create({ data: { id: userId, name, email: `${userId}@example.test` } });
  const firstDeviceId = await register(userId, `${userId}-first`);
  const historyKey = createHistoryKeyPair();
  await caller(userId, firstDeviceId).accountHistory.create({
    algorithm: historyKey.algorithm,
    id: crypto.randomUUID(),
    publicKey: historyKey.publicKey,
  });
  if (!withActivePhone) {
    await prisma.userDevice.update({
      where: { id: firstDeviceId },
      data: { revokedAt: new Date() },
    });
  }
  const pendingDeviceId = await register(userId, `${userId}-pending`);
  return {
    firstDeviceId,
    historyPrivateKey: historyKey.privateKey,
    pending: caller(userId, pendingDeviceId),
    pendingDeviceId,
    userId,
  };
};

const activatedAt = async (deviceId: string) =>
  (await prisma.userDevice.findUniqueOrThrow({ where: { id: deviceId } })).activatedAt;

afterAll(async () => {
  if (process.env["OPENBEACON_INTEGRATION"] !== "1") return;
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "a phone that isn't set up yet",
  () => {
    test("can register, check its status and get set up by link or by phrase", async () => {
      const account = await createAccount("steps");
      const { pending } = account;

      expect(await activatedAt(account.pendingDeviceId)).toBeNull();
      expect((await pending.auth.deviceKeyContext()).userId).toBe(account.userId);
      expect(await pending.device.status()).toEqual({
        accountHasActiveDevice: true,
        activated: false,
        registered: true,
      });
      expect((await pending.accountRecovery.status()).currentHistoryKey?.version).toBe(1);
      expect(await pending.accountRecovery.escrows()).toEqual([]);
      expect(await pending.account.deletionVerificationMethods()).toEqual({
        google: false,
        password: false,
      });
      expect(await pending.account.version()).toBe("9.9.9");

      const { linkId } = await pending.deviceLink.create();
      expect(await pending.deviceLink.status({ linkId })).toMatchObject({ state: "waiting" });

      const challenge = await pending.device.activationChallenge();
      await expect(pending.device.activate({ answer: "AAAA" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      const retry = await pending.device.activationChallenge();
      expect(retry.historyKeyVersion).toBe(challenge.historyKeyVersion);
      const answer = openDeviceActivationChallenge({
        deviceId: account.pendingDeviceId,
        historyPrivateKey: account.historyPrivateKey,
        sealed: retry.sealed,
        userId: account.userId,
      });
      expect(await pending.device.activate({ answer })).toEqual({ activated: true });
      expect(await activatedAt(account.pendingDeviceId)).toEqual(expect.any(Date));
      expect(await pending.account.listDevices()).toHaveLength(2);
    });

    test("can start fresh", async () => {
      const account = await createAccount("fresh", { withActivePhone: false });
      const recoveryKey = deriveRecoveryKeyPair(generateRecoveryPhrase());
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

      expect(await activatedAt(account.pendingDeviceId)).toEqual(expect.any(Date));
    });

    test("can cancel by removing itself", async () => {
      const account = await createAccount("cancel");
      await prisma.session.create({
        data: {
          deviceId: account.pendingDeviceId,
          expiresAt: new Date(Date.now() + 60 * 60_000),
          id: `${account.userId}-session`,
          token: `${account.userId}-token`,
          userId: account.userId,
        },
      });

      await account.pending.account.removeThisDevice();

      expect(
        (await prisma.userDevice.findUniqueOrThrow({ where: { id: account.pendingDeviceId } }))
          .revokedAt,
      ).toEqual(expect.any(Date));
      expect(await prisma.session.count({ where: { userId: account.userId } })).toBe(0);
    });

    test("can't see or change anything else on the account", async () => {
      const account = await createAccount("refused");
      const { pending } = account;

      const calls: (() => Promise<unknown>)[] = [
        () => pending.account.listDevices(),
        () => pending.account.updateDevice({ deviceId: account.pendingDeviceId, name: "Mine" }),
        () => pending.account.requestDeletion({ password: "password" }),
        () => pending.account.signOutOtherSessions(),
        () =>
          pending.emailAlerts.updateSettings({
            alertDeletionScheduled: false,
            alertNewSignIn: false,
          }),
        () => pending.groupInvites.decline({ inviteId: `${account.userId}-invite` }),
        () => pending.groupMembership.list(),
        () => pending.deviceLink.get({ linkId: crypto.randomUUID() }),
      ];
      for (const call of calls) {
        const result = await tryCatch(call());
        expect(result.error).toMatchObject({ code: "FORBIDDEN" });
        expect((result.error as { cause?: unknown }).cause).toBeInstanceOf(DevicePendingError);
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.userId } });
      expect(user).toMatchObject({ alertNewSignIn: true, pendingDeletion: false });
      expect(
        (await prisma.userDevice.findUniqueOrThrow({ where: { id: account.pendingDeviceId } }))
          .name,
      ).not.toBe("Mine");
    });
  },
);
