import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  deriveRecoveryKeyPair,
  type EpochKeyMaterial,
  encodeBase64,
  type GroupEpoch,
  generateRecoveryPhrase,
  type HistoryPrivateKeyMaterial,
  type HistoryPublicKey,
  type RecipientPublicKeyMaterial,
  sealHistoryKeyEscrow,
  unwrapHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { HISTORY_RECIPIENT_MISMATCH_MESSAGE } from "@openbeacon/schemas";
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
const prefix = `epoch-history-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;

type Account = {
  deviceId: string;
  history: { id: string; privateKey: HistoryPrivateKeyMaterial; version: number } | null;
  key: ReturnType<typeof createDeviceKeyPair>;
  userId: string;
};

const account = (name: string): Account => ({
  deviceId: `${prefix}-${name}-device`,
  history: null,
  key: createDeviceKeyPair(),
  userId: `${prefix}-${name}`,
});
const owner = account("owner");
const member = account("member");
const late = account("late");
const sharer = account("sharer");
const outsider = account("outsider");
const accounts = [owner, member, late, sharer, outsider];

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

const newHistoryKey = (target: Account, version: number) => {
  const recoveryKey = deriveRecoveryKeyPair(generateRecoveryPhrase());
  const historyKey = createHistoryKeyPair();
  const id = crypto.randomUUID();
  return {
    apply: () => {
      target.history = { id, privateKey: historyKey.privateKey, version };
    },
    input: {
      historyKey: {
        algorithm: historyKey.algorithm,
        escrow: sealHistoryKeyEscrow({
          historyPrivateKey: historyKey.privateKey,
          recoveryPrivateKey: recoveryKey.privateKey,
          userId: target.userId,
          version,
        }),
        id,
        publicKey: historyKey.publicKey,
        version,
      },
      recoveryKey: {
        algorithm: recoveryKey.algorithm,
        derivationVersion: recoveryKey.derivationVersion,
        publicKey: recoveryKey.publicKey,
      },
    },
  };
};

const setupPhrase = async (target: Account) => {
  const next = newHistoryKey(target, 1);
  await caller(target.userId).accountRecovery.setup(next.input);
  next.apply();
};

const resetPhrase = async (target: Account) => {
  const next = newHistoryKey(target, (target.history?.version ?? 0) + 1);
  await caller(target.userId).accountRecovery.reset({ ...next.input, confirmReset: true });
  next.apply();
};

const creatorOf = (creator: Account) => ({
  deviceId: creator.deviceId,
  privateKey: creator.key.privateKey,
});

const buildBundle = ({
  creator,
  historyRecipients,
  previousEpoch,
  recipients,
}: {
  creator: Account;
  historyRecipients: HistoryPublicKey[];
  previousEpoch: GroupEpoch | null;
  recipients: RecipientPublicKeyMaterial[];
}) => {
  const result = previousEpoch
    ? createNextGroupEpoch({ creator: creatorOf(creator), previousEpoch, recipients })
    : createInitialGroupEpoch({ creator: creatorOf(creator), groupId, recipients });
  const wrapTo = (historyKey: HistoryPublicKey, epochId = result.epoch.epochId) =>
    wrapEpochKeyForHistoryKey({
      epochId,
      epochKey: result.epochKey,
      historyKey,
      senderPrivateKey: creator.key.privateKey,
    });
  return {
    bundle: {
      createdByDeviceId: creator.deviceId,
      epochId: result.epoch.epochId,
      epochNumber: result.epoch.epochNumber,
      historyKeys: historyRecipients.map((key) => wrapTo(key)),
      recipientKeys: result.wrappedKeys,
    },
    epochId: result.epoch.epochId,
    epochKey: result.epochKey,
    wrapTo,
  };
};

const flagRotation = () =>
  prisma.group.update({ data: { epochRotationRequired: true }, where: { id: groupId } });

const buildRotation = async (creator: Account) => {
  await flagRotation();
  const context = await caller(creator.userId).groupEpoch.rotationContext({ groupId });
  return {
    context: context!,
    ...buildBundle({
      creator,
      historyRecipients: context!.historyRecipients,
      previousEpoch: context!.latestEpoch,
      recipients: context!.recipients,
    }),
  };
};

const rotate = (creator: Account, nextEpoch: ReturnType<typeof buildBundle>["bundle"]) =>
  caller(creator.userId).groupEpoch.rotate({ groupId, nextEpoch });

const historyWrapOwners = async (epochId: string) =>
  (
    await prisma.groupEpochHistoryWrap.findMany({
      select: { historyKey: { select: { userId: true, version: true } } },
      where: { groupEpochId: epochId },
    })
  )
    .map(({ historyKey }) => `${historyKey.userId}@${historyKey.version}`)
    .sort();

const expectedOwners = (...owners: Account[]) =>
  owners.map((item) => `${item.userId}@${item.history!.version}`).sort();

const readsWithHistoryKey = async (reader: Account, epochId: string) => {
  const { historyWraps } = await caller(reader.userId).groupEpoch.getEpochKeyWraps({
    deviceId: reader.deviceId,
    epochId,
    groupId,
  });
  const wrap = historyWraps.find(
    ({ historyKeyVersion }) => historyKeyVersion === reader.history!.version,
  );
  if (!wrap) throw new Error(`${reader.userId} has no history wrap for ${epochId}`);
  return unwrapHistoryEpochKey({
    epochId,
    historyKeyVersion: reader.history!.version,
    historyPrivateKey: reader.history!.privateKey,
    userId: reader.userId,
    wrappedEpochKey: wrap,
  }).expose();
};

const expectReadable = async (readers: Account[], epochId: string, epochKey: EpochKeyMaterial) => {
  for (const reader of readers) {
    expect(await readsWithHistoryKey(reader, epochId)).toEqual(epochKey.expose());
  }
};

const rejectsWith = async (promise: Promise<unknown>, message: string) => {
  await expect(promise).rejects.toMatchObject({ code: "BAD_REQUEST", message });
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group epoch history recipients with PostgreSQL",
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
      }
      for (const item of [owner, member, sharer, outsider]) {
        await setupPhrase(item);
      }
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: accounts.map(({ userId }) => userId) } } });
      await prisma.$disconnect();
    });

    test("group creation wraps the first epoch to the creator's current history key", async () => {
      const context = await caller(owner.userId).auth.deviceKeyContext();
      expect(context.historyRecipients).toEqual([
        {
          historyKeyId: owner.history!.id,
          publicKey: expect.any(String),
          userId: owner.userId,
          version: 1,
        },
      ]);
      const first = buildBundle({
        creator: owner,
        historyRecipients: context.historyRecipients,
        previousEpoch: null,
        recipients: context.recipients,
      });
      await caller(owner.userId).groupLifecycle.create({
        groupId,
        initialEpoch: first.bundle,
        name: "Family",
      });
      expect(await historyWrapOwners(first.epochId)).toEqual(expectedOwners(owner));
      await expectReadable([owner], first.epochId, first.epochKey);
      const stored = await prisma.groupEpochHistoryWrap.findFirstOrThrow({
        where: { groupEpochId: first.epochId },
      });
      expect(stored).toMatchObject({
        historyKeyId: owner.history!.id,
        senderDeviceId: owner.deviceId,
        senderPublicKey: owner.key.publicKey,
      });
    });

    test("invite acceptance wraps the join epoch to exactly the members with a history key, joiner included", async () => {
      for (const joiner of [member, late]) {
        await caller(owner.userId).groupInvites.send({
          groupId,
          invites: [{ email: `${joiner.userId}@example.test`, role: "MEMBER" }],
        });
        const invite = (await caller(joiner.userId).groupInvites.list()).find(
          (item) => item.group.id === groupId,
        )!;
        const context = await caller(joiner.userId).groupInvites.acceptanceContext({
          inviteId: invite.id,
        });
        const next = buildBundle({
          creator: joiner,
          historyRecipients: context.historyRecipients,
          previousEpoch: context.latestEpoch,
          recipients: context.recipients,
        });
        await caller(joiner.userId).groupInvites.accept({
          inviteId: invite.id,
          nextEpoch: next.bundle,
        });
        expect(await historyWrapOwners(next.epochId)).toEqual(expectedOwners(owner, member));
        await expectReadable([owner, member], next.epochId, next.epochKey);
      }
    });

    test("a joiner can't receive history wraps for epochs before their join through the creation path", async () => {
      const { code } = await caller(owner.userId).groupInvites.createShared({ groupId });
      const context = await caller(sharer.userId).groupInvites.sharedAcceptanceContext({ code });
      expect(context.historyRecipients.map(({ userId }) => userId).sort()).toEqual(
        [owner.userId, member.userId, sharer.userId].sort(),
      );
      const next = buildBundle({
        creator: sharer,
        historyRecipients: context.historyRecipients,
        previousEpoch: context.latestEpoch,
        recipients: context.recipients,
      });
      const ownWrap = context.historyRecipients.find(({ userId }) => userId === sharer.userId)!;
      const earlierEpochWrap = next.wrapTo(ownWrap, context.latestEpoch!.epochId);
      await rejectsWith(
        caller(sharer.userId).groupInvites.acceptShared({
          code,
          nextEpoch: {
            ...next.bundle,
            historyKeys: next.bundle.historyKeys.map((wrap) =>
              wrap.userId === sharer.userId ? earlierEpochWrap : wrap,
            ),
          },
        }),
        "Wrapped epoch keys must target the same epoch.",
      );
      await rejectsWith(
        caller(sharer.userId).groupInvites.acceptShared({
          code,
          nextEpoch: {
            ...next.bundle,
            historyKeys: [...next.bundle.historyKeys, earlierEpochWrap],
          },
        }),
        "Wrapped epoch keys must target the same epoch.",
      );

      await caller(sharer.userId).groupInvites.acceptShared({ code, nextEpoch: next.bundle });
      expect(await historyWrapOwners(next.epochId)).toEqual(expectedOwners(owner, member, sharer));
      await expectReadable([owner, member, sharer], next.epochId, next.epochKey);
      const sharerWraps = await prisma.groupEpochHistoryWrap.findMany({
        select: { groupEpochId: true },
        where: { groupEpoch: { groupId }, historyKeyId: sharer.history!.id },
      });
      expect(sharerWraps).toEqual([{ groupEpochId: next.epochId }]);
    });

    test("the exact-set check rejects missing, extra, duplicate and stale-version history wraps", async () => {
      const staleKey = (await caller(member.userId).auth.deviceKeyContext()).historyRecipients[0]!;
      const nextKey = createHistoryKeyPair();
      const nextKeyId = crypto.randomUUID();
      const escrow = sealHistoryKeyEscrow({
        historyPrivateKey: nextKey.privateKey,
        recoveryPrivateKey: deriveRecoveryKeyPair(generateRecoveryPhrase()).privateKey,
        userId: member.userId,
        version: 2,
      });
      await prisma.accountHistoryKey.create({
        data: {
          algorithm: nextKey.algorithm,
          escrowAlgorithm: escrow.algorithm,
          escrowCiphertext: escrow.ciphertext,
          escrowEnc: escrow.enc,
          id: nextKeyId,
          publicKey: nextKey.publicKey,
          userId: member.userId,
          version: 2,
        },
      });
      member.history = { id: nextKeyId, privateKey: nextKey.privateKey, version: 2 };

      const rotation = await buildRotation(owner);
      const wraps = rotation.bundle.historyKeys;
      const recipientFor = (target: Account) =>
        rotation.context.historyRecipients.find(({ userId }) => userId === target.userId)!;
      expect(recipientFor(member)).toMatchObject({ historyKeyId: nextKeyId, version: 2 });
      const outsiderKey = await caller(outsider.userId).auth.deviceKeyContext();
      const cases = [
        wraps.filter(({ userId }) => userId !== member.userId),
        [],
        [...wraps, rotation.wrapTo(outsiderKey.historyRecipients[0]!)],
        [...wraps, rotation.wrapTo(recipientFor(member))],
        wraps.map((wrap) => (wrap.userId === member.userId ? rotation.wrapTo(staleKey) : wrap)),
        [...wraps, rotation.wrapTo(staleKey)],
        wraps.map((wrap) =>
          wrap.userId === member.userId
            ? rotation.wrapTo({ ...recipientFor(member), userId: late.userId })
            : wrap,
        ),
      ];
      for (const historyKeys of cases) {
        await rejectsWith(
          rotate(owner, { ...rotation.bundle, historyKeys }),
          HISTORY_RECIPIENT_MISMATCH_MESSAGE,
        );
      }
      await rejectsWith(
        rotate(owner, {
          ...rotation.bundle,
          historyKeys: wraps.map((wrap) =>
            wrap.userId === member.userId
              ? wrapEpochKeyForHistoryKey({
                  epochId: rotation.epochId,
                  epochKey: rotation.epochKey,
                  historyKey: recipientFor(member),
                  senderPrivateKey: member.key.privateKey,
                })
              : wrap,
          ),
        }),
        "Wrapped epoch keys must be created by the active device.",
      );
      await rejectsWith(
        rotate(owner, {
          ...rotation.bundle,
          historyKeys: wraps.map((wrap) =>
            wrap.userId === member.userId
              ? { ...wrap, ephemeralPublicKey: encodeBase64(new Uint8Array(32)) }
              : wrap,
          ),
        }),
        "Invalid wrapped epoch key public key.",
      );
      await expect(
        rotate(owner, {
          ...rotation.bundle,
          historyKeys: wraps.map((wrap) => ({
            ...wrap,
            privateKey: encodeBase64(member.history!.privateKey.expose()),
          })),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await prisma.groupEpoch.count({ where: { id: rotation.epochId } })).toBe(0);

      await expect(rotate(owner, rotation.bundle)).resolves.toEqual({ rotated: true });
      expect(await historyWrapOwners(rotation.epochId)).toEqual(
        expectedOwners(owner, member, sharer),
      );
      await expectReadable([member], rotation.epochId, rotation.epochKey);
    });

    test("a phrase set up while an epoch is being created is rejected and the rebuilt epoch succeeds", async () => {
      const first = await buildRotation(owner);
      expect(first.context.historyRecipients.map(({ userId }) => userId)).not.toContain(
        late.userId,
      );
      await setupPhrase(late);
      await rejectsWith(rotate(owner, first.bundle), HISTORY_RECIPIENT_MISMATCH_MESSAGE);

      const retry = await buildRotation(owner);
      await expect(rotate(owner, retry.bundle)).resolves.toEqual({ rotated: true });
      expect(await historyWrapOwners(retry.epochId)).toEqual(
        expectedOwners(owner, member, late, sharer),
      );
      await expectReadable([late], retry.epochId, retry.epochKey);
    });

    test("a reset racing epoch creation is rejected as a version mismatch and the rebuilt epoch succeeds", async () => {
      const first = await buildRotation(owner);
      const lock = await holdRowLock({ db: prisma, id: groupId, table: "Group" });
      const rotation = rotate(owner, first.bundle);
      await lock.waitForWaiters(1);
      await resetPhrase(member);
      expect(member.history!.version).toBe(3);
      await lock.release();
      await rejectsWith(rotation, HISTORY_RECIPIENT_MISMATCH_MESSAGE);

      const retry = await buildRotation(owner);
      expect(
        retry.context.historyRecipients.find(({ userId }) => userId === member.userId)?.version,
      ).toBe(3);
      await expect(rotate(owner, retry.bundle)).resolves.toEqual({ rotated: true });
      expect(await historyWrapOwners(retry.epochId)).toEqual(
        expectedOwners(owner, member, late, sharer),
      );
      await expectReadable([member], retry.epochId, retry.epochKey);
    });

    test("epoch creation holds the history keys it wraps to until it commits", async () => {
      const rotation = await buildRotation(owner);
      const lock = await holdRowLock({
        db: prisma,
        id: member.history!.id,
        mode: "FOR NO KEY UPDATE",
        table: "AccountHistoryKey",
      });
      const pending = rotate(owner, rotation.bundle);
      await lock.waitForWaiters(1);
      await lock.release();
      await expect(pending).resolves.toEqual({ rotated: true });
      await expectReadable([member], rotation.epochId, rotation.epochKey);
    });

    test("removal wraps the next epoch to everyone except the removed member", async () => {
      const sharerMember = await prisma.groupMember.findUniqueOrThrow({
        where: { userId_groupId: { groupId, userId: sharer.userId } },
      });
      const context = await caller(owner.userId).groupMembership.removalContext({
        groupId,
        memberId: sharerMember.id,
      });
      expect(context.historyRecipients.map(({ userId }) => userId).sort()).toEqual(
        [owner.userId, member.userId, late.userId].sort(),
      );
      const removal = buildBundle({
        creator: owner,
        historyRecipients: context.historyRecipients,
        previousEpoch: context.latestEpoch,
        recipients: context.recipients,
      });
      const sharerKey = (await caller(sharer.userId).auth.deviceKeyContext()).historyRecipients[0]!;
      await rejectsWith(
        caller(owner.userId).groupMembership.remove({
          groupId,
          memberId: sharerMember.id,
          nextEpoch: {
            ...removal.bundle,
            historyKeys: [...removal.bundle.historyKeys, removal.wrapTo(sharerKey)],
          },
        }),
        HISTORY_RECIPIENT_MISMATCH_MESSAGE,
      );

      await caller(owner.userId).groupMembership.remove({
        groupId,
        memberId: sharerMember.id,
        nextEpoch: removal.bundle,
      });
      expect(await historyWrapOwners(removal.epochId)).toEqual(expectedOwners(owner, member, late));
      expect(
        await prisma.groupEpochHistoryWrap.count({
          where: { groupEpoch: { groupId }, historyKeyId: sharer.history!.id },
        }),
      ).toBe(0);
      await expectReadable([owner, member, late], removal.epochId, removal.epochKey);
    });
  },
);
