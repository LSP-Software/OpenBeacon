import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
  type HistoryPrivateKeyMaterial,
  type HistoryPublicKey,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { DevicePendingError } from "../../lib/deviceActivation.ts";
import { getGroupJoinContext, getGroupRemovalContext } from "../../lib/groupEpochs.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountRecoveryRouter } from "../accountRecoveryRouter.ts";
import { authRouter } from "../authRouter.ts";
import { groupEpochRouter } from "./groupEpochRouter.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";

setDefaultTimeout(60_000);

const router = createTRPCRouter({
  accountRecovery: accountRecoveryRouter,
  auth: authRouter,
  groupEpoch: groupEpochRouter,
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `epoch-wraps-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const pagedGroupId = `${prefix}-paged-group`;

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
const outsider = account("outsider");
const accounts = [owner, member, outsider];

const caller = (
  userId: string,
  deviceId = accounts.find((item) => item.userId === userId)?.deviceId ?? null,
) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      session: {
        user: { id: userId },
        session: { id: `${userId}-session`, createdAt: new Date() },
      },
    }) as Parameters<typeof router.createCaller>[0],
  );

const bundle = ({
  creator,
  historyRecipients,
  result,
}: {
  creator: Account;
  historyRecipients: HistoryPublicKey[];
  result: ReturnType<typeof createInitialGroupEpoch>;
}) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: historyRecipients.map((historyKey) =>
    wrapEpochKeyForHistoryKey({
      epochId: result.epoch.epochId,
      epochKey: result.epochKey,
      historyKey,
      senderPrivateKey: creator.key.privateKey,
    }),
  ),
  recipientKeys: result.wrappedKeys,
});

const createGroup = async (id: string) => {
  const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: owner.deviceId } });
  const initial = createInitialGroupEpoch({
    creator: { deviceId: owner.deviceId, privateKey: owner.key.privateKey },
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
  const { historyRecipients } = await caller(owner.userId).auth.deviceKeyContext();
  await caller(owner.userId).groupLifecycle.create({
    groupId: id,
    initialEpoch: bundle({ creator: owner, historyRecipients, result: initial }),
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
  await caller(joiner.userId).groupInvites.accept({
    inviteId: invite.id,
    nextEpoch: bundle({
      creator: joiner,
      historyRecipients: context.historyRecipients,
      result: next,
    }),
  });
  return next;
};

const addHistoryWrap = async (
  wrapper: Account,
  epoch: ReturnType<typeof createInitialGroupEpoch>,
) => {
  await caller(wrapper.userId).groupEpoch.addHistoryWraps({
    deviceId: wrapper.deviceId,
    groupId,
    historyKeyId: wrapper.historyKey.id,
    wraps: [
      wrapEpochKeyForHistoryKey({
        epochId: epoch.epoch.epochId,
        epochKey: epoch.epochKey,
        historyKey: {
          publicKey: wrapper.historyKey.publicKey,
          userId: wrapper.userId,
          version: 1,
        },
        senderPrivateKey: wrapper.key.privateKey,
      }),
    ],
  });
};

const list = (
  reader: Account,
  input: { cursor?: number; deviceId?: string; groupId?: string; limit?: number },
) =>
  caller(reader.userId).groupEpoch.listEpochKeyWraps({
    deviceId: reader.deviceId,
    groupId,
    ...input,
  });

const epochs: Record<"first" | "second", ReturnType<typeof createInitialGroupEpoch>> = {} as never;

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "listing a member's epoch key wraps with PostgreSQL",
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
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
            userId: item.userId,
          },
        });
      }
      epochs.first = await createGroup(groupId);
      epochs.second = await join(groupId, member);
      for (const item of accounts) {
        const historyKey = createHistoryKeyPair();
        item.historyKey = {
          id: crypto.randomUUID(),
          privateKey: historyKey.privateKey,
          publicKey: historyKey.publicKey,
        };
        await prisma.accountHistoryKey.create({
          data: {
            algorithm: historyKey.algorithm,
            id: item.historyKey.id,
            publicKey: historyKey.publicKey,
            userId: item.userId,
            version: 1,
          },
        });
      }
      await addHistoryWrap(owner, epochs.first);
      await addHistoryWrap(owner, epochs.second);
      await addHistoryWrap(member, epochs.second);
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: [groupId, pagedGroupId] } } });
      await prisma.user.deleteMany({ where: { id: { in: accounts.map(({ userId }) => userId) } } });
      await prisma.$disconnect();
    });

    test("lists entitled epochs newest first with the caller's own wraps", async () => {
      const ownerPage = await list(owner, {});
      expect(ownerPage.nextCursor).toBeNull();
      expect(ownerPage.epochs.map(({ epochNumber }) => epochNumber)).toEqual([2, 1]);
      for (const [index, expected] of [epochs.second, epochs.first].entries()) {
        const listed = ownerPage.epochs[index]!;
        expect(listed.epochId).toBe(expected.epoch.epochId);
        expect(listed.createdAt).toBeInstanceOf(Date);
        expect(listed.historyWraps).toHaveLength(1);
        expect(listed.historyWraps[0]).toMatchObject({
          historyKeyVersion: 1,
          userId: owner.userId,
        });
        expect(
          unwrapEpochKey({
            recipientDeviceId: owner.deviceId,
            recipientPrivateKey: owner.key.privateKey,
            wrappedEpochKey: listed.deviceWrap!,
          }).expose(),
        ).toEqual(expected.epochKey.expose());
        expect(
          unwrapHistoryEpochKey({
            epochId: expected.epoch.epochId,
            historyKeyVersion: 1,
            historyPrivateKey: owner.historyKey.privateKey,
            userId: owner.userId,
            wrappedEpochKey: listed.historyWraps[0]!,
          }).expose(),
        ).toEqual(expected.epochKey.expose());
      }

      const memberPage = await list(member, {});
      expect(memberPage.epochs.map(({ epochNumber }) => epochNumber)).toEqual([2]);
      expect(memberPage.epochs[0]!.historyWraps).toMatchObject([{ userId: member.userId }]);
    });

    test("never returns another user's device wraps", async () => {
      const page = await list(member, { deviceId: owner.deviceId });
      expect(page.epochs.map(({ deviceWrap }) => deviceWrap)).toEqual([null]);
      expect(page.epochs[0]!.historyWraps).toMatchObject([{ userId: member.userId }]);
    });

    test("rejects callers who aren't members of the group", async () => {
      await expect(list(outsider, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("pages newest first in pages of 100", async () => {
      await createGroup(pagedGroupId);
      await prisma.groupEpoch.createMany({
        data: Array.from({ length: 102 }, (_, index) => ({
          epochNumber: index + 2,
          groupId: pagedGroupId,
          id: `${pagedGroupId}-epoch-${index + 2}`,
          senderPublicKey: owner.key.publicKey,
        })),
      });

      const first = await list(owner, { groupId: pagedGroupId });
      expect(first.epochs).toHaveLength(100);
      expect(first.epochs[0]!.epochNumber).toBe(103);
      expect(first.epochs.at(-1)!.epochNumber).toBe(4);
      expect(first.nextCursor).toBe(4);

      const second = await list(owner, { cursor: 4, groupId: pagedGroupId });
      expect(second.epochs.map(({ epochNumber }) => epochNumber)).toEqual([3, 2, 1]);
      expect(second.nextCursor).toBeNull();
      expect(second.epochs.at(-1)!.deviceWrap).not.toBeNull();
    });

    test("uses the limit as the page size and keeps the cursor at the last returned epoch", async () => {
      const latest = await list(owner, { groupId: pagedGroupId, limit: 1 });
      expect(latest.epochs.map(({ epochNumber }) => epochNumber)).toEqual([103]);
      expect(latest.nextCursor).toBe(103);

      const next = await list(owner, { cursor: 103, groupId: pagedGroupId, limit: 2 });
      expect(next.epochs.map(({ epochNumber }) => epochNumber)).toEqual([102, 101]);
      expect(next.nextCursor).toBe(101);

      const whole = await list(owner, { limit: 5 });
      expect(whole.epochs.map(({ epochNumber }) => epochNumber)).toEqual([2, 1]);
      expect(whole.nextCursor).toBeNull();
    });

    test("leaves a removed device out of wraps and recipients", async () => {
      await prisma.userDevice.update({
        where: { id: member.deviceId },
        data: { revokedAt: new Date() },
      });

      await expect(list(member, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
      const tabletId = `${prefix}-member-tablet`;
      await prisma.userDevice.create({
        data: {
          activatedAt: new Date(),
          icon: "tablet",
          id: tabletId,
          name: "Tablet",
          publicKey: createDeviceKeyPair().publicKey,
          publicKeyAlgorithm: "X25519",
          userId: member.userId,
        },
      });
      const page = await caller(member.userId, tabletId).groupEpoch.listEpochKeyWraps({
        deviceId: member.deviceId,
        groupId,
      });
      expect(page.epochs.map(({ deviceWrap }) => deviceWrap)).toEqual([null]);
      const single = await caller(member.userId, tabletId).groupEpoch.getEpochKeyWraps({
        deviceId: member.deviceId,
        epochId: epochs.second.epoch.epochId,
        groupId,
      });
      expect(single.deviceWrap).toBeNull();
      const recipients = await caller(owner.userId).groupEpoch.listRecipientPublicKeys({ groupId });
      expect(JSON.stringify(recipients)).not.toContain(member.deviceId);

      await prisma.userDevice.update({ where: { id: member.deviceId }, data: { revokedAt: null } });
      await prisma.userDevice.delete({ where: { id: tabletId } });
    });

    test("leaves a Pending device out of every recipient set and refuses its wrap requests", async () => {
      const pendingId = `${prefix}-member-pending`;
      const pendingKey = createDeviceKeyPair();
      await prisma.userDevice.create({
        data: {
          icon: "phone",
          id: pendingId,
          name: "New phone",
          publicKey: pendingKey.publicKey,
          publicKeyAlgorithm: "X25519",
          userId: member.userId,
        },
      });
      const pending = caller(member.userId, pendingId);
      for (const request of [
        () => pending.groupEpoch.getLatest({ groupId }),
        () => pending.groupEpoch.rotationContext({ groupId }),
        () => pending.groupEpoch.listRecipientPublicKeys({ groupId }),
        () => pending.groupEpoch.listEpochKeyWraps({ deviceId: pendingId, groupId }),
        () =>
          pending.groupEpoch.getEpochKeyWraps({
            deviceId: pendingId,
            epochId: epochs.second.epoch.epochId,
            groupId,
          }),
        () => pending.groupEpoch.listHistoryBackfill({ deviceId: pendingId, groupId }),
        () =>
          pending.groupEpoch.addHistoryWraps({
            deviceId: pendingId,
            groupId,
            historyKeyId: member.historyKey.id,
            wraps: [
              wrapEpochKeyForHistoryKey({
                epochId: epochs.second.epoch.epochId,
                epochKey: epochs.second.epochKey,
                historyKey: {
                  publicKey: member.historyKey.publicKey,
                  userId: member.userId,
                  version: 1,
                },
                senderPrivateKey: pendingKey.privateKey,
              }),
            ],
          }),
      ]) {
        await expect(request()).rejects.toMatchObject({
          code: "FORBIDDEN",
          cause: expect.any(DevicePendingError),
        });
      }

      const recipientIds = (recipients: { deviceId: string }[]) =>
        recipients.map(({ deviceId }) => deviceId);
      const listed = await caller(owner.userId).groupEpoch.listRecipientPublicKeys({ groupId });
      expect(listed.map(({ id }) => id)).not.toContain(pendingId);
      const join = await getGroupJoinContext({ db: prisma, groupId, userId: member.userId });
      expect(recipientIds(join.recipients)).toEqual(
        [owner.deviceId, member.deviceId].sort((a, b) => a.localeCompare(b)),
      );
      const ownerMember = await prisma.groupMember.findFirstOrThrow({
        where: { groupId, userId: owner.userId },
      });
      const removal = await getGroupRemovalContext({
        db: prisma,
        groupId,
        memberId: ownerMember.id,
      });
      expect(recipientIds(removal.recipients)).toEqual([member.deviceId]);

      await prisma.userDevice.delete({ where: { id: pendingId } });
    });

    test("rejects limits outside 1 to 100", async () => {
      await expect(list(owner, { limit: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(list(owner, { limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  },
);
