import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
} from "@openbeacon/encryption";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `group-limit-${crypto.randomUUID()}`;
const ownerId = `${prefix}-owner`;
const joinerId = `${prefix}-joiner`;
const targetGroupId = `${prefix}-target`;
const keys = { [ownerId]: createDeviceKeyPair(), [joinerId]: createDeviceKeyPair() };
const fillerGroupIds = Array.from({ length: 16 }, (_, index) => `${prefix}-filler-${index}`);
const groupLimitReached = {
  code: "PRECONDITION_FAILED",
  cause: { reason: "GROUP_LIMIT_REACHED" },
};
const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: `${userId}-device`,
      session: { user: { id: userId }, session: { id: `${userId}-session` } },
    }) as Parameters<typeof router.createCaller>[0],
  );
const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: [],
  recipientKeys: result.wrappedKeys,
});
const createInput = async (userId: string, groupId: string) => {
  const device = await prisma.userDevice.findUniqueOrThrow({ where: { id: `${userId}-device` } });
  return {
    groupId,
    name: groupId.slice(-20),
    initialEpoch: bundle(
      createInitialGroupEpoch({
        creator: { deviceId: device.id, privateKey: keys[userId]!.privateKey },
        groupId,
        recipients: [
          {
            algorithm: "X25519",
            createdAt: device.createdAt,
            deviceId: device.id,
            publicKey: device.publicKey,
            revokedAt: device.revokedAt,
            userId,
          },
        ],
      }),
    ),
  };
};
const joinerGroupCount = () => prisma.groupMember.count({ where: { userId: joinerId } });

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("group membership cap", () => {
  beforeAll(async () => {
    for (const userId of [ownerId, joinerId]) {
      await prisma.user.create({
        data: { id: userId, name: userId, email: `${userId}@example.test` },
      });
      await prisma.session.create({
        data: {
          id: `${userId}-session`,
          token: `${userId}-token`,
          userId,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await prisma.userDevice.create({
        data: {
          id: `${userId}-device`,
          userId,
          publicKey: keys[userId]!.publicKey,
          publicKeyAlgorithm: keys[userId]!.algorithm,
          name: "Phone",
          icon: "phone",
          activatedAt: new Date(),
        },
      });
    }
    await caller(ownerId).groupLifecycle.create(await createInput(ownerId, targetGroupId));
    await prisma.group.createMany({
      data: fillerGroupIds.map((id, index) => ({ id, name: `Filler ${index}` })),
    });
    await prisma.groupMember.createMany({
      data: fillerGroupIds.map((groupId) => ({
        groupId,
        userId: joinerId,
        role: "OWNER" as const,
        joinedEpochNumber: 1,
      })),
    });
    await prisma.groupMemberInvite.create({
      data: { groupId: targetGroupId, recipientId: joinerId, inviterId: ownerId, role: "MEMBER" },
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, joinerId] } } });
    await prisma.$disconnect();
  });

  test("a 17th group is refused when creating, accepting an invite or redeeming a join code", async () => {
    expect(await joinerGroupCount()).toBe(16);
    const joiner = caller(joinerId);

    await expect(
      joiner.groupLifecycle.create(await createInput(joinerId, `${prefix}-17th`)),
    ).rejects.toMatchObject(groupLimitReached);

    const [invite] = await joiner.groupInvites.list();
    const context = await joiner.groupInvites.acceptanceContext({ inviteId: invite!.id });
    const nextEpoch = bundle(
      createNextGroupEpoch({
        creator: { deviceId: `${joinerId}-device`, privateKey: keys[joinerId]!.privateKey },
        previousEpoch: context.latestEpoch!,
        recipients: context.recipients,
      }),
    );
    await expect(
      joiner.groupInvites.accept({ inviteId: invite!.id, nextEpoch }),
    ).rejects.toMatchObject(groupLimitReached);

    const { code, id } = await caller(ownerId).groupInvites.createShared({
      groupId: targetGroupId,
    });
    await expect(joiner.groupInvites.acceptShared({ code, nextEpoch })).rejects.toMatchObject(
      groupLimitReached,
    );

    expect(await joinerGroupCount()).toBe(16);
    expect(
      await caller(ownerId).groupInvites.sharedStatuses({
        groupId: targetGroupId,
        inviteIds: [id],
      }),
    ).toEqual([{ id, status: "active" }]);
    expect(await prisma.groupMemberInvite.count({ where: { recipientId: joinerId } })).toBe(1);
  });

  test("two joins racing for the last place can't both get in", async () => {
    await prisma.group.delete({ where: { id: fillerGroupIds[0]! } });
    expect(await joinerGroupCount()).toBe(15);
    const joiner = caller(joinerId);
    const { code } = await caller(ownerId).groupInvites.createShared({ groupId: targetGroupId });
    const context = await joiner.groupInvites.sharedAcceptanceContext({ code });
    const nextEpoch = bundle(
      createNextGroupEpoch({
        creator: { deviceId: `${joinerId}-device`, privateKey: keys[joinerId]!.privateKey },
        previousEpoch: context.latestEpoch!,
        recipients: context.recipients,
      }),
    );

    const results = await Promise.allSettled([
      joiner.groupInvites.acceptShared({ code, nextEpoch }),
      joiner.groupLifecycle.create(await createInput(joinerId, `${prefix}-race`)),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject(groupLimitReached);
    expect(await joinerGroupCount()).toBe(16);
  });
});
