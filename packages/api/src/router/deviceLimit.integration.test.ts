import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createDeviceLinkSecret,
  createHistoryKeyPair,
  deriveRecoveryKeyPair,
  generateRecoveryPhrase,
  openDeviceActivationChallenge,
  sealDeviceLinkHandover,
  sealHistoryKeyEscrow,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";
import { accountHistoryRouter } from "./accountHistoryRouter.ts";
import { accountRecoveryRouter } from "./accountRecoveryRouter.ts";
import { accountRouter } from "./accountRouter.ts";
import { authRouter } from "./authRouter.ts";
import { deviceLinkRouter } from "./deviceLinkRouter.ts";
import { deviceRouter } from "./deviceRouter.ts";

const router = createTRPCRouter({
  account: accountRouter,
  accountHistory: accountHistoryRouter,
  accountRecovery: accountRecoveryRouter,
  auth: authRouter,
  device: deviceRouter,
  deviceLink: deviceLinkRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `device-limit-${crypto.randomUUID()}`;
const userIds: string[] = [];
const deviceLimit = {
  code: "PRECONDITION_FAILED",
  message:
    "Your account already has 10 phones set up. Remove one in Account › Devices to set up this one.",
  cause: { reason: "DEVICE_LIMIT" },
};

const caller = (
  userId: string,
  deviceId: string | null,
  {
    securityAlerts = null,
    sessionCreatedAt = new Date(),
  }: {
    securityAlerts?: { send: (userId: string, alert: { type: string }) => void } | null;
    sessionCreatedAt?: Date;
  } = {},
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
        session: { id: `${userId}-${deviceId}-session`, createdAt: sessionCreatedAt },
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

const createAccount = async (name: string, { activePhones }: { activePhones: number }) => {
  const userId = `${prefix}-${name}`;
  userIds.push(userId);
  await prisma.user.create({ data: { id: userId, name, email: `${userId}@example.test` } });
  const active = await register(userId, "active");
  const historyKey = createHistoryKeyPair();
  await active.api.accountHistory.create({
    algorithm: historyKey.algorithm,
    id: crypto.randomUUID(),
    publicKey: historyKey.publicKey,
  });
  const otherIds = Array.from({ length: activePhones - 1 }, (_, index) => `${userId}-old-${index}`);
  await prisma.userDevice.createMany({
    data: otherIds.map((id) => ({
      activatedAt: new Date(),
      activatedBy: "link" as const,
      icon: "phone" as const,
      id,
      name: id.slice(userId.length + 1),
      publicKey: createDeviceKeyPair().publicKey,
      publicKeyAlgorithm: "X25519",
      userId,
    })),
  });
  const pending = await register(userId, "pending");
  return { active, historyKey, otherIds, pending, userId };
};

const phraseAnswer = async (
  account: Awaited<ReturnType<typeof createAccount>>,
  pending: Awaited<ReturnType<typeof register>>,
) => {
  const challenge = await pending.api.device.activationChallenge();
  return openDeviceActivationChallenge({
    deviceId: pending.deviceId,
    historyPrivateKey: account.historyKey.privateKey,
    sealed: challenge.sealed,
    userId: account.userId,
  });
};

const resetFrom = (api: ReturnType<typeof caller>, userId: string) => {
  const recoveryKey = deriveRecoveryKeyPair(generateRecoveryPhrase());
  const historyKey = createHistoryKeyPair();
  return api.accountRecovery.reset({
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
};

const activatedCount = (userId: string) =>
  prisma.userDevice.count({ where: { userId, activatedAt: { not: null }, revokedAt: null } });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "device limit with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    });

    test("an eleventh phone can't be set up by phrase, link or reset until one is removed", async () => {
      const account = await createAccount("full", { activePhones: 10 });
      const { pending } = account;
      expect(await pending.api.device.status()).toMatchObject({ deviceLimitReached: true });
      expect(await account.active.api.device.status()).toMatchObject({
        deviceLimitReached: false,
      });

      await expect(
        pending.api.device.activate({ answer: await phraseAnswer(account, pending) }),
      ).rejects.toMatchObject(deviceLimit);

      const { linkId } = await pending.api.deviceLink.create();
      await expect(
        account.active.api.deviceLink.approve({
          linkId,
          ...sealDeviceLinkHandover({
            approverPrivateKey: account.active.privateKey,
            historyKeys: [{ privateKey: account.historyKey.privateKey, version: 1 }],
            linkId,
            newDeviceId: pending.deviceId,
            newDevicePublicKey: pending.publicKey,
            psk: createDeviceLinkSecret(),
            userId: account.userId,
          }),
        }),
      ).rejects.toMatchObject(deviceLimit);
      expect(await pending.api.deviceLink.status({ linkId })).toMatchObject({ state: "waiting" });

      await expect(resetFrom(pending.api, account.userId)).rejects.toMatchObject(deviceLimit);
      expect(
        await prisma.accountHistoryKey.findMany({
          select: { version: true },
          where: { userId: account.userId },
        }),
      ).toEqual([{ version: 1 }]);
      expect(
        (await prisma.userDevice.findUniqueOrThrow({ where: { id: pending.deviceId } }))
          .activatedAt,
      ).toBeNull();
      expect(await activatedCount(account.userId)).toBe(10);

      await account.active.api.account.removeDevice({ deviceId: account.otherIds[0]! });
      expect(await pending.api.device.status()).toMatchObject({ deviceLimitReached: false });
      await pending.api.device.activate({ answer: await phraseAnswer(account, pending) });
      expect(await activatedCount(account.userId)).toBe(10);
    });

    test("phones that aren't set up don't count towards the limit", async () => {
      const account = await createAccount("pending-extra", { activePhones: 9 });
      const morePending = [
        await register(account.userId, "pending-2"),
        await register(account.userId, "pending-3"),
      ];
      expect(await account.pending.api.device.status()).toMatchObject({
        deviceLimitReached: false,
      });
      await account.pending.api.device.activate({
        answer: await phraseAnswer(account, account.pending),
      });
      expect(await activatedCount(account.userId)).toBe(10);
      for (const next of morePending) {
        expect(await next.api.device.status()).toMatchObject({ deviceLimitReached: true });
      }
    });

    test("two phones set up at once can't take the account past the limit", async () => {
      const account = await createAccount("race", { activePhones: 9 });
      const second = await register(account.userId, "pending-2");
      const answers = [
        await phraseAnswer(account, account.pending),
        await phraseAnswer(account, second),
      ];
      const results = await Promise.allSettled([
        account.pending.api.device.activate({ answer: answers[0]! }),
        second.api.device.activate({ answer: answers[1]! }),
      ]);
      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      const refused = results.find((result) => result.status === "rejected");
      expect(refused?.status === "rejected" ? refused.reason : null).toMatchObject(deviceLimit);
      expect(await activatedCount(account.userId)).toBe(10);
    });

    test("a phone stuck at the limit can remove one other phone, and only then", async () => {
      const account = await createAccount("stuck", { activePhones: 9 });
      const { pending } = account;
      expect(await pending.api.device.devicesAtLimit()).toEqual([]);
      await expect(
        pending.api.device.removeAtLimit({ deviceId: account.otherIds[0]! }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Your account has fewer than 10 phones set up now, so you can set up this one.",
      });

      await prisma.userDevice.create({
        data: {
          activatedAt: new Date(),
          activatedBy: "link",
          icon: "phone",
          id: `${account.userId}-tenth`,
          name: "Tenth",
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          userId: account.userId,
        },
      });
      expect((await pending.api.device.devicesAtLimit()).map(({ id }) => id).sort()).toEqual(
        [account.active.deviceId, ...account.otherIds, `${account.userId}-tenth`].sort(),
      );

      const stale = caller(account.userId, pending.deviceId, {
        sessionCreatedAt: new Date(Date.now() - 2 * 60 * 60_000),
      });
      await expect(
        stale.device.removeAtLimit({ deviceId: account.otherIds[0]! }),
      ).rejects.toMatchObject({ cause: { reason: "FRESH_SIGN_IN_REQUIRED" } });

      const second = await register(account.userId, "pending-2");
      await expect(
        pending.api.device.removeAtLimit({ deviceId: second.deviceId }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const send = mock((_userId: string, _alert: { type: string }) => {});
      await caller(account.userId, pending.deviceId, {
        securityAlerts: { send },
      }).device.removeAtLimit({ deviceId: account.otherIds[0]! });
      expect(
        (await prisma.userDevice.findUniqueOrThrow({ where: { id: account.otherIds[0]! } }))
          .revokedAt,
      ).not.toBeNull();
      expect(send.mock.calls).toEqual([
        [account.userId, expect.objectContaining({ type: "device-removed" }), pending.deviceId],
      ]);

      await expect(
        pending.api.device.removeAtLimit({ deviceId: account.otherIds[1]! }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await activatedCount(account.userId)).toBe(9);
      await pending.api.device.activate({ answer: await phraseAnswer(account, pending) });
      expect(await activatedCount(account.userId)).toBe(10);
    });
  },
);
