import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  type DevicePrivateKeyMaterial,
  deriveRecoveryKeyPair,
  type EpochKeyMaterial,
  encodeBase64,
  generateRecoveryPhrase,
  type HistoryPrivateKeyMaterial,
  sealHistoryKeyEscrow,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  type WrappedHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { holdRowLock } from "../../lib/databaseLocks.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountRecoveryRouter } from "../accountRecoveryRouter.ts";
import { authRouter } from "../authRouter.ts";
import { groupEpochRouter } from "./groupEpochRouter.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";

setDefaultTimeout(60_000);

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const router = createTRPCRouter({
  accountRecovery: accountRecoveryRouter,
  auth: authRouter,
  groupEpoch: groupEpochRouter,
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
});
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
const prefix = `history-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const otherGroupId = `${prefix}-other-group`;
const soloGroupId = `${prefix}-solo-group`;
const rejoinGroupId = `${prefix}-rejoin-group`;

type Account = {
  deviceId: string;
  historyKey: { id: string; privateKey: HistoryPrivateKeyMaterial; publicKey: string };
  key: ReturnType<typeof createDeviceKeyPair>;
  userId: string;
};

const account = (name: string): Account => ({
  deviceId: `${prefix}-${name}-device`,
  historyKey: { id: "", privateKey: createHistoryKeyPair().privateKey, publicKey: "" },
  key: createDeviceKeyPair(),
  userId: `${prefix}-${name}`,
});
const owner = account("owner");
const member = account("member");
const other = account("other");
const accounts = [owner, member, other];

const caller = (userId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: {
      user: { id: userId },
      session: { id: `${userId}-session`, createdAt: new Date() },
    },
  } as Parameters<typeof router.createCaller>[0]);

const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  recipientKeys: result.wrappedKeys,
});

const createGroup = async (id: string, creator: Account) => {
  const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: creator.deviceId } });
  const initial = createInitialGroupEpoch({
    creator: { deviceId: creator.deviceId, privateKey: creator.key.privateKey },
    groupId: id,
    recipients: [
      {
        algorithm: "X25519",
        createdAt: device.createdAt,
        deviceId: device.id,
        publicKey: device.publicKey,
        revokedAt: device.revokedAt,
        userId: device.userId,
      },
    ],
  });
  await caller(creator.userId).groupLifecycle.create({
    groupId: id,
    initialEpoch: bundle(initial),
    name: "Family",
  });
  return initial;
};

const join = async (id: string, joiner: Account) => {
  await caller(owner.userId).groupInvites.send({
    groupId: id,
    invites: [{ email: `${joiner.userId}@example.test`, role: "MEMBER" }],
  });
  const invite = (await caller(joiner.userId).groupInvites.list()).find(
    (item) => item.group.id === id,
  )!;
  const context = await caller(joiner.userId).groupInvites.acceptanceContext({
    inviteId: invite.id,
  });
  const next = createNextGroupEpoch({
    creator: { deviceId: joiner.deviceId, privateKey: joiner.key.privateKey },
    previousEpoch: context.latestEpoch!,
    recipients: context.recipients,
  });
  await caller(joiner.userId).groupInvites.accept({ inviteId: invite.id, nextEpoch: bundle(next) });
  return next;
};

const wrapFor = ({
  account: wrapper,
  epochId,
  epochKey,
  senderPrivateKey = wrapper.key.privateKey,
  userId = wrapper.userId,
  version = 1,
}: {
  account: Account;
  epochId: string;
  epochKey: EpochKeyMaterial;
  senderPrivateKey?: DevicePrivateKeyMaterial;
  userId?: string;
  version?: number;
}) =>
  wrapEpochKeyForHistoryKey({
    epochId,
    epochKey,
    historyKey: { publicKey: wrapper.historyKey.publicKey, userId, version },
    senderPrivateKey,
  });

const addWraps = (
  wrapper: Account,
  wraps: WrappedHistoryEpochKey[],
  overrides: { deviceId?: string; groupId?: string; historyKeyId?: string } = {},
) =>
  caller(wrapper.userId).groupEpoch.addHistoryWraps({
    deviceId: wrapper.deviceId,
    groupId,
    historyKeyId: wrapper.historyKey.id,
    wraps,
    ...overrides,
  });

const backfillEpochNumbers = async (wrapper: Account, id = groupId, cursor: number | null = null) =>
  (
    await caller(wrapper.userId).groupEpoch.listHistoryBackfill({
      cursor,
      deviceId: wrapper.deviceId,
      groupId: id,
    })
  ).epochs.map(({ epochNumber }) => epochNumber);

const epochs: Record<
  "first" | "second" | "third" | "other",
  ReturnType<typeof createInitialGroupEpoch>
> = {} as never;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group history wraps with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: accounts.map(({ userId }) => ({
          id: userId,
          name: userId,
          email: `${userId}@example.test`,
        })),
      });
      await prisma.session.createMany({
        data: accounts.map(({ userId }) => ({
          id: `${userId}-session`,
          token: `${userId}-token`,
          userId,
          expiresAt: new Date(Date.now() + 60_000),
        })),
      });
      for (const item of accounts) {
        await prisma.userDevice.create({
          data: {
            id: item.deviceId,
            publicKey: item.key.publicKey,
            publicKeyAlgorithm: item.key.algorithm,
            userId: item.userId,
          },
        });
        const phrase = generateRecoveryPhrase();
        const recoveryKey = deriveRecoveryKeyPair(phrase);
        const historyKey = createHistoryKeyPair();
        item.historyKey = {
          id: crypto.randomUUID(),
          privateKey: historyKey.privateKey,
          publicKey: historyKey.publicKey,
        };
        await caller(item.userId).accountRecovery.setup({
          historyKey: {
            algorithm: historyKey.algorithm,
            escrow: sealHistoryKeyEscrow({
              historyPrivateKey: historyKey.privateKey,
              recoveryPublicKey: recoveryKey.publicKey,
              userId: item.userId,
              version: 1,
            }),
            id: item.historyKey.id,
            publicKey: historyKey.publicKey,
            version: 1,
          },
          recoveryKey: {
            algorithm: recoveryKey.algorithm,
            derivationVersion: recoveryKey.derivationVersion,
            publicKey: recoveryKey.publicKey,
          },
        });
      }
      epochs.first = await createGroup(groupId, owner);
      epochs.second = await join(groupId, member);
      epochs.third = await join(groupId, other);
      await createGroup(otherGroupId, owner);
      epochs.other = await join(otherGroupId, member);
      await createGroup(soloGroupId, owner);
    });

    afterAll(async () => {
      await prisma.group.deleteMany({
        where: { id: { in: [groupId, otherGroupId, soloGroupId, rejoinGroupId] } },
      });
      await prisma.user.deleteMany({ where: { id: { in: accounts.map(({ userId }) => userId) } } });
      await prisma.$disconnect();
    });

    test("group creation and invite acceptance record the epoch each membership began", async () => {
      const members = await prisma.groupMember.findMany({
        select: { joinedEpochNumber: true, userId: true },
        where: { groupId },
      });
      expect(Object.fromEntries(members.map((row) => [row.userId, row.joinedEpochNumber]))).toEqual(
        { [owner.userId]: 1, [member.userId]: 2, [other.userId]: 3 },
      );
    });

    test("backfill offers only entitled epochs and wraps are stored idempotently", async () => {
      expect(await backfillEpochNumbers(owner)).toEqual([1, 2, 3]);
      expect(await backfillEpochNumbers(owner, groupId, 1)).toEqual([2, 3]);
      expect(await backfillEpochNumbers(member)).toEqual([2, 3]);
      expect(await backfillEpochNumbers(other)).toEqual([3]);

      for (const wrapper of [owner, member]) {
        const page = await caller(wrapper.userId).groupEpoch.listHistoryBackfill({
          deviceId: wrapper.deviceId,
          groupId,
        });
        expect(page.historyKey).toMatchObject({ id: wrapper.historyKey.id, version: 1 });
        const wraps = page.epochs.map(({ deviceWrap, epochId }) =>
          wrapFor({
            account: wrapper,
            epochId,
            epochKey: unwrapEpochKey({
              recipientDeviceId: wrapper.deviceId,
              recipientPrivateKey: wrapper.key.privateKey,
              wrappedEpochKey: deviceWrap,
            }),
          }),
        );
        expect(await addWraps(wrapper, wraps)).toEqual({ added: wraps.length });
        expect(await addWraps(wrapper, wraps)).toEqual({ added: 0 });
        expect(await backfillEpochNumbers(wrapper)).toEqual([]);
      }

      const read = await caller(member.userId).groupEpoch.getEpochKeyWraps({
        deviceId: member.deviceId,
        epochId: epochs.second.epoch.epochId,
        groupId,
      });
      expect(read.deviceWrap?.senderPublicKey).toBe(member.key.publicKey);
      expect(read.historyWraps).toHaveLength(1);
      expect(read.historyWraps[0]).toMatchObject({
        historyKeyVersion: 1,
        senderPublicKey: member.key.publicKey,
        userId: member.userId,
      });
      expect(
        unwrapEpochKey({
          recipientDeviceId: member.deviceId,
          recipientPrivateKey: member.key.privateKey,
          wrappedEpochKey: read.deviceWrap!,
        }).expose(),
      ).toEqual(epochs.second.epochKey.expose());
      expect(
        unwrapHistoryEpochKey({
          epochId: epochs.second.epoch.epochId,
          historyKeyVersion: 1,
          historyPrivateKey: member.historyKey.privateKey,
          userId: member.userId,
          wrappedEpochKey: read.historyWraps[0]!,
        }).expose(),
      ).toEqual(epochs.second.epochKey.expose());

      const ownerRead = await caller(owner.userId).groupEpoch.getEpochKeyWraps({
        deviceId: owner.deviceId,
        epochId: epochs.second.epoch.epochId,
        groupId,
      });
      expect(ownerRead.deviceWrap?.senderPublicKey).toBe(member.key.publicKey);
      expect(ownerRead.historyWraps).toMatchObject([
        { senderPublicKey: owner.key.publicKey, userId: owner.userId },
      ]);
      expect(
        await caller(member.userId).groupEpoch.getEpochKeyWraps({
          deviceId: owner.deviceId,
          epochId: epochs.second.epoch.epochId,
          groupId,
        }),
      ).toMatchObject({ deviceWrap: null });
    });

    test("a member who joined at epoch N can't add a history wrap for epoch N-1", async () => {
      const wrap = wrapFor({
        account: other,
        epochId: epochs.second.epoch.epochId,
        epochKey: epochs.second.epochKey,
      });
      await expect(addWraps(other, [wrap])).rejects.toMatchObject({ code: "FORBIDDEN" });

      const leftover = await prisma.groupEpochRecipientKey.create({
        data: {
          algorithm: epochs.second.wrappedKeys[0]!.algorithm,
          ephemeralPublicKey: epochs.second.wrappedKeys[0]!.ephemeralPublicKey,
          groupEpochId: epochs.second.epoch.epochId,
          recipientDeviceId: other.deviceId,
          wrappedKey: epochs.second.wrappedKeys[0]!.wrappedKey,
        },
      });
      try {
        expect(await backfillEpochNumbers(other)).toEqual([3]);
        await expect(addWraps(other, [wrap])).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.groupEpochRecipientKey.delete({ where: { id: leftover.id } });
      }
      expect(
        await prisma.groupEpochHistoryWrap.count({ where: { historyKeyId: other.historyKey.id } }),
      ).toBe(0);
    });

    test("rejects wraps from another user's device and other invalid wraps", async () => {
      const epochId = epochs.third.epoch.epochId;
      const epochKey = epochs.third.epochKey;
      const valid = wrapFor({ account: other, epochId, epochKey });
      const rejects = async (
        wraps: WrappedHistoryEpochKey[],
        code: string,
        overrides: Parameters<typeof addWraps>[2] = {},
      ) => {
        await expect(addWraps(other, wraps, overrides)).rejects.toMatchObject({ code });
      };

      await rejects(
        [wrapFor({ account: other, epochId, epochKey, senderPrivateKey: owner.key.privateKey })],
        "FORBIDDEN",
        { deviceId: owner.deviceId },
      );
      await rejects(
        [wrapFor({ account: other, epochId, epochKey, senderPrivateKey: owner.key.privateKey })],
        "BAD_REQUEST",
      );
      await rejects(
        [wrapFor({ account: other, epochId, epochKey, userId: owner.userId })],
        "BAD_REQUEST",
      );
      await rejects([valid], "CONFLICT", { historyKeyId: owner.historyKey.id });
      await rejects(
        [{ ...valid, ephemeralPublicKey: encodeBase64(new Uint8Array(32)) }],
        "BAD_REQUEST",
      );
      await rejects([valid, valid], "BAD_REQUEST");
      await rejects(
        Array.from({ length: 51 }, () => valid),
        "BAD_REQUEST",
      );
      await rejects(
        [{ ...valid, privateKey: encodeBase64(other.historyKey.privateKey.expose()) } as never],
        "BAD_REQUEST",
      );
      await expect(
        caller(other.userId).groupEpoch.addHistoryWraps({
          deviceId: other.deviceId,
          groupId,
          historyKeyId: other.historyKey.id,
          privateKey: encodeBase64(other.historyKey.privateKey.expose()),
          wraps: [valid],
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        addWraps(owner, [wrapFor({ account: owner, epochId, epochKey })], { groupId: soloGroupId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const crossGroupWrap = wrapFor({
        account: member,
        epochId: epochs.other.epoch.epochId,
        epochKey: epochs.other.epochKey,
      });
      await expect(addWraps(member, [crossGroupWrap])).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await addWraps(member, [crossGroupWrap], { groupId: otherGroupId })).toEqual({
        added: 1,
      });

      const revokedDeviceId = `${prefix}-other-revoked-device`;
      await prisma.userDevice.create({
        data: {
          id: revokedDeviceId,
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          revokedAt: new Date(),
          userId: other.userId,
        },
      });
      await prisma.groupEpochRecipientKey.updateMany({
        data: { recipientDeviceId: revokedDeviceId },
        where: { groupEpochId: epochId, recipientDeviceId: other.deviceId },
      });
      try {
        await rejects([valid], "FORBIDDEN");
        await prisma.userDevice.update({
          data: { revokedAt: null },
          where: { id: revokedDeviceId },
        });
        await prisma.userDevice.update({
          data: { revokedAt: new Date() },
          where: { id: other.deviceId },
        });
        await rejects([valid], "FORBIDDEN");
      } finally {
        await prisma.userDevice.update({
          data: { revokedAt: null },
          where: { id: other.deviceId },
        });
        await prisma.groupEpochRecipientKey.updateMany({
          data: { recipientDeviceId: other.deviceId },
          where: { groupEpochId: epochId, recipientDeviceId: revokedDeviceId },
        });
        await prisma.userDevice.delete({ where: { id: revokedDeviceId } });
      }
      expect(
        await prisma.groupEpochHistoryWrap.count({ where: { historyKeyId: other.historyKey.id } }),
      ).toBe(0);
    });

    test("a wrap for a non-current history version is rejected", async () => {
      const epochId = epochs.third.epoch.epochId;
      const epochKey = epochs.third.epochKey;
      const nextHistoryKey = createHistoryKeyPair();
      const nextHistoryKeyId = crypto.randomUUID();
      await prisma.accountHistoryKey.create({
        data: {
          algorithm: "X25519",
          escrowAlgorithm: "HPKE-Base-X25519-HKDF-SHA256-ChaCha20Poly1305",
          escrowCiphertext: "c",
          escrowEnc: "e",
          id: nextHistoryKeyId,
          publicKey: nextHistoryKey.publicKey,
          userId: other.userId,
          version: 2,
        },
      });
      try {
        await expect(
          addWraps(other, [wrapFor({ account: other, epochId, epochKey })]),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        await expect(
          addWraps(other, [wrapFor({ account: other, epochId, epochKey })], {
            historyKeyId: nextHistoryKeyId,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(
          (
            await caller(other.userId).groupEpoch.listHistoryBackfill({
              deviceId: other.deviceId,
              groupId,
            })
          ).historyKey,
        ).toMatchObject({ id: nextHistoryKeyId, version: 2 });
      } finally {
        await prisma.accountHistoryKey.delete({ where: { id: nextHistoryKeyId } });
      }
      expect(await addWraps(other, [wrapFor({ account: other, epochId, epochKey })])).toEqual({
        added: 1,
      });
    });

    test("backfill pages through only the epochs the device holds", async () => {
      const first = await prisma.groupEpochRecipientKey.findFirstOrThrow({
        where: { groupEpoch: { groupId: soloGroupId }, recipientDeviceId: owner.deviceId },
      });
      const epochNumbers = Array.from({ length: 100 }, (_, index) => index + 2);
      await prisma.groupEpoch.createMany({
        data: epochNumbers.map((epochNumber) => ({
          epochNumber,
          groupId: soloGroupId,
          id: `${soloGroupId}-epoch-${epochNumber}`,
          senderPublicKey: owner.key.publicKey,
        })),
      });
      await prisma.groupEpochRecipientKey.createMany({
        data: epochNumbers
          .filter((epochNumber) => epochNumber % 2 === 0)
          .map((epochNumber) => ({
            algorithm: first.algorithm,
            ephemeralPublicKey: first.ephemeralPublicKey,
            groupEpochId: `${soloGroupId}-epoch-${epochNumber}`,
            recipientDeviceId: owner.deviceId,
            wrappedKey: first.wrappedKey,
          })),
      });
      const firstPage = await caller(owner.userId).groupEpoch.listHistoryBackfill({
        deviceId: owner.deviceId,
        groupId: soloGroupId,
      });
      expect(firstPage.epochs.map(({ epochNumber }) => epochNumber)).toEqual([
        1,
        ...epochNumbers.filter((epochNumber) => epochNumber % 2 === 0 && epochNumber < 100),
      ]);
      expect(firstPage.nextCursor).toBe(98);
      expect(await backfillEpochNumbers(owner, soloGroupId, firstPage.nextCursor)).toEqual([100]);
    });

    test("departure deletes the member's history wraps and backfill racing departure is rejected", async () => {
      await prisma.group.update({ data: { epochRotationRequired: true }, where: { id: groupId } });
      const rotationContext = await caller(owner.userId).groupEpoch.rotationContext({ groupId });
      const rotated = createNextGroupEpoch({
        creator: { deviceId: owner.deviceId, privateKey: owner.key.privateKey },
        previousEpoch: rotationContext!.latestEpoch!,
        recipients: rotationContext!.recipients,
      });
      await caller(owner.userId).groupEpoch.rotate({ groupId, nextEpoch: bundle(rotated) });
      expect(await backfillEpochNumbers(member)).toEqual([4]);
      const ownerWrapsBefore = await prisma.groupEpochHistoryWrap.count({
        where: { historyKeyId: owner.historyKey.id },
      });

      const memberRow = await prisma.groupMember.findUniqueOrThrow({
        where: { userId_groupId: { groupId, userId: member.userId } },
      });
      const removalContext = await caller(member.userId).groupMembership.removalContext({
        groupId,
        memberId: memberRow.id,
      });
      const departure = createNextGroupEpoch({
        creator: { deviceId: member.deviceId, privateKey: member.key.privateKey },
        previousEpoch: removalContext.latestEpoch!,
        recipients: removalContext.recipients,
      });

      const lock = await holdRowLock({ db: prisma, id: groupId, table: "Group" });
      const removal = caller(member.userId).groupMembership.remove({
        groupId,
        memberId: memberRow.id,
        nextEpoch: bundle(departure),
      });
      await lock.waitForWaiters(1);
      const backfill = addWraps(member, [
        wrapFor({
          account: member,
          epochId: rotated.epoch.epochId,
          epochKey: rotated.epochKey,
        }),
      ]);
      await lock.waitForWaiters(2);
      await lock.release();

      await expect(removal).resolves.toMatchObject({ message: "Group member removed." });
      await expect(backfill).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        await prisma.groupEpochHistoryWrap.count({
          where: { groupEpoch: { groupId }, historyKeyId: member.historyKey.id },
        }),
      ).toBe(0);
      expect(
        await prisma.groupEpochHistoryWrap.count({
          where: { groupEpoch: { groupId: otherGroupId }, historyKeyId: member.historyKey.id },
        }),
      ).toBe(1);
      expect(
        await prisma.groupEpochHistoryWrap.count({ where: { historyKeyId: owner.historyKey.id } }),
      ).toBe(ownerWrapsBefore);
    });

    test("registering a new device flags the user's groups for rotation but re-registering doesn't", async () => {
      await prisma.group.updateMany({
        data: { epochRotationRequired: false },
        where: { id: { in: [groupId, otherGroupId, soloGroupId] } },
      });
      const flags = async () =>
        Object.fromEntries(
          (
            await prisma.group.findMany({
              select: { epochRotationRequired: true, id: true },
              where: { id: { in: [groupId, otherGroupId, soloGroupId] } },
            })
          ).map(({ epochRotationRequired, id }) => [id, epochRotationRequired]),
        );

      await caller(member.userId).auth.registerDeviceKey({
        algorithm: "X25519",
        deviceId: member.deviceId,
        expectedUserId: member.userId,
        publicKey: member.key.publicKey,
      });
      expect(await flags()).toEqual({
        [groupId]: false,
        [otherGroupId]: false,
        [soloGroupId]: false,
      });

      await caller(member.userId).auth.registerDeviceKey({
        algorithm: "X25519",
        deviceId: `${prefix}-member-new-device`,
        expectedUserId: member.userId,
        publicKey: createDeviceKeyPair().publicKey,
      });
      expect(await flags()).toEqual({
        [groupId]: false,
        [otherGroupId]: true,
        [soloGroupId]: false,
      });
    });

    test("getEpochKeyWraps returns nothing for epochs before the caller joined", async () => {
      const secondEpochId = epochs.second.epoch.epochId;
      const emptyRead = { deviceWrap: null, historyWraps: [] };
      const readAs = (wrapper: Account) =>
        caller(wrapper.userId).groupEpoch.getEpochKeyWraps({
          deviceId: wrapper.deviceId,
          epochId: secondEpochId,
          groupId,
        });
      expect(await readAs(other)).toEqual(emptyRead);

      const leftoverDeviceWrap = await prisma.groupEpochRecipientKey.create({
        data: {
          algorithm: epochs.second.wrappedKeys[0]!.algorithm,
          ephemeralPublicKey: epochs.second.wrappedKeys[0]!.ephemeralPublicKey,
          groupEpochId: secondEpochId,
          recipientDeviceId: other.deviceId,
          wrappedKey: epochs.second.wrappedKeys[0]!.wrappedKey,
        },
      });
      const leftoverHistoryWrap = await prisma.groupEpochHistoryWrap.create({
        data: {
          algorithm: epochs.second.wrappedKeys[0]!.algorithm,
          ephemeralPublicKey: epochs.second.wrappedKeys[0]!.ephemeralPublicKey,
          groupEpochId: secondEpochId,
          historyKeyId: other.historyKey.id,
          senderDeviceId: other.deviceId,
          senderPublicKey: other.key.publicKey,
          wrappedKey: epochs.second.wrappedKeys[0]!.wrappedKey,
        },
      });
      try {
        expect(await readAs(other)).toEqual(emptyRead);
        const listed = await caller(other.userId).groupEpoch.listEpochKeyWraps({
          deviceId: other.deviceId,
          groupId,
        });
        expect(listed.epochs.map(({ epochNumber }) => epochNumber)).not.toContain(2);
      } finally {
        await prisma.groupEpochHistoryWrap.delete({
          where: { id: leftoverHistoryWrap.id },
        });
        await prisma.groupEpochRecipientKey.delete({
          where: { id: leftoverDeviceWrap.id },
        });
      }
    });

    test("a member who leaves and rejoins can't read or back up epochs from the earlier membership", async () => {
      await createGroup(rejoinGroupId, owner);
      const firstMembership = await join(rejoinGroupId, member);
      const memberRow = await prisma.groupMember.findUniqueOrThrow({
        where: {
          userId_groupId: { groupId: rejoinGroupId, userId: member.userId },
        },
      });
      const removalContext = await caller(member.userId).groupMembership.removalContext({
        groupId: rejoinGroupId,
        memberId: memberRow.id,
      });
      const departure = createNextGroupEpoch({
        creator: {
          deviceId: member.deviceId,
          privateKey: member.key.privateKey,
        },
        previousEpoch: removalContext.latestEpoch!,
        recipients: removalContext.recipients,
      });
      await caller(member.userId).groupMembership.remove({
        groupId: rejoinGroupId,
        memberId: memberRow.id,
        nextEpoch: bundle(departure),
      });
      const rejoined = await join(rejoinGroupId, member);

      const readEpoch = (epochId: string) =>
        caller(member.userId).groupEpoch.getEpochKeyWraps({
          deviceId: member.deviceId,
          epochId,
          groupId: rejoinGroupId,
        });
      expect(
        await prisma.groupEpochRecipientKey.count({
          where: {
            groupEpochId: firstMembership.epoch.epochId,
            recipientDeviceId: member.deviceId,
          },
        }),
      ).toBe(1);
      expect(await readEpoch(firstMembership.epoch.epochId)).toEqual({
        deviceWrap: null,
        historyWraps: [],
      });
      expect(await readEpoch(rejoined.epoch.epochId)).toMatchObject({
        deviceWrap: { epochId: rejoined.epoch.epochId },
      });
      const listed = await caller(member.userId).groupEpoch.listEpochKeyWraps({
        deviceId: member.deviceId,
        groupId: rejoinGroupId,
      });
      expect(listed.epochs.map(({ epochNumber }) => epochNumber)).toEqual([
        rejoined.epoch.epochNumber,
      ]);
      expect(await backfillEpochNumbers(member, rejoinGroupId)).toEqual([
        rejoined.epoch.epochNumber,
      ]);
      await expect(
        addWraps(
          member,
          [
            wrapFor({
              account: member,
              epochId: firstMembership.epoch.epochId,
              epochKey: firstMembership.epochKey,
            }),
          ],
          { groupId: rejoinGroupId },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        await addWraps(
          member,
          [
            wrapFor({
              account: member,
              epochId: rejoined.epoch.epochId,
              epochKey: rejoined.epochKey,
            }),
          ],
          { groupId: rejoinGroupId },
        ),
      ).toEqual({ added: 1 });
    });

    test("listHistoryBackfill rejects another member's device and a revoked device", async () => {
      const backfillWith = (deviceId: string) =>
        caller(other.userId).groupEpoch.listHistoryBackfill({
          deviceId,
          groupId,
        });
      await expect(backfillWith(owner.deviceId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      await prisma.userDevice.update({
        data: { revokedAt: new Date() },
        where: { id: other.deviceId },
      });
      try {
        await expect(backfillWith(other.deviceId)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      } finally {
        await prisma.userDevice.update({
          data: { revokedAt: null },
          where: { id: other.deviceId },
        });
      }
      await expect(backfillWith(other.deviceId)).resolves.toHaveProperty("epochs");
    });
  },
);
