import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
} from "@openbeacon/encryption";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
});
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => 0 });
const prefix = `email-invite-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const users = [0, 1, 2, 3].map((i) => `${prefix}-${i}`);
const email = (userId: string) => `${userId}@example.test`;
const caller = (userId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id: userId } },
  } as Parameters<typeof router.createCaller>[0]);
const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  recipientKeys: result.wrappedKeys,
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "email group invitations with PostgreSQL",
  () => {
    beforeAll(async () => {
      for (const userId of users) {
        const key = createDeviceKeyPair();
        await prisma.user.create({ data: { id: userId, name: userId, email: email(userId) } });
        await prisma.userDevice.create({
          data: {
            id: `${userId}-device`,
            userId,
            publicKey: key.publicKey,
            publicKeyAlgorithm: key.algorithm,
          },
        });
      }
      const device = await prisma.userDevice.findUniqueOrThrow({
        where: { id: `${users[0]}-device` },
      });
      const initial = createInitialGroupEpoch({
        createdByDeviceId: device.id,
        groupId,
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
      await caller(users[0]!).groupLifecycle.create({
        groupId,
        name: "Family",
        initialEpoch: bundle(initial),
      });
    });

    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("authorizes, deduplicates, declines and accepts invitations atomically across concurrent joins", async () => {
      const owner = caller(users[0]!);
      const first = caller(users[1]!);
      const second = caller(users[2]!);
      const outsider = caller(users[3]!);
      const invites = [
        { email: email(users[1]!), role: "ADMIN" as const },
        { email: email(users[2]!), role: "MEMBER" as const },
        { email: email(users[1]!), role: "MEMBER" as const },
        { email: email(users[0]!), role: "MEMBER" as const },
        { email: `${prefix}-unknown@example.test`, role: "MEMBER" as const },
      ];
      await expect(outsider.groupInvites.send({ groupId, invites })).rejects.toThrow();
      await Promise.all([
        owner.groupInvites.send({ groupId, invites }),
        owner.groupInvites.send({ groupId, invites }),
      ]);
      expect(await prisma.groupMemberInvite.count({ where: { groupId } })).toBe(2);
      const firstInvite = (await first.groupInvites.list())[0]!;
      const secondInvite = (await second.groupInvites.list())[0]!;
      expect(await outsider.groupInvites.list()).toHaveLength(0);
      await expect(
        outsider.groupInvites.acceptanceContext({ inviteId: firstInvite.id }),
      ).rejects.toThrow("Invite not found");
      await expect(outsider.groupInvites.decline({ inviteId: firstInvite.id })).rejects.toThrow(
        "Invite not found",
      );
      const firstContext = await first.groupInvites.acceptanceContext({ inviteId: firstInvite.id });
      const secondContext = await second.groupInvites.acceptanceContext({
        inviteId: secondInvite.id,
      });
      const firstEpoch = bundle(
        createNextGroupEpoch({
          createdByDeviceId: `${users[1]}-device`,
          previousEpoch: firstContext.latestEpoch!,
          recipients: firstContext.recipients,
        }),
      );
      const secondEpoch = bundle(
        createNextGroupEpoch({
          createdByDeviceId: `${users[2]}-device`,
          previousEpoch: secondContext.latestEpoch!,
          recipients: secondContext.recipients,
        }),
      );
      await expect(
        outsider.groupInvites.accept({ inviteId: firstInvite.id, nextEpoch: firstEpoch }),
      ).rejects.toThrow("Invite not found");
      await expect(
        first.groupInvites.accept({
          inviteId: firstInvite.id,
          nextEpoch: { ...firstEpoch, recipientKeys: [] },
        }),
      ).rejects.toThrow();
      expect(await first.groupInvites.list()).toHaveLength(1);
      expect(await prisma.groupMember.count({ where: { groupId } })).toBe(1);
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(1);
      const results = await Promise.allSettled([
        first.groupInvites.accept({ inviteId: firstInvite.id, nextEpoch: firstEpoch }),
        second.groupInvites.accept({ inviteId: secondInvite.id, nextEpoch: secondEpoch }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const winnerIndex = results[0]!.status === "fulfilled" ? 1 : 2;
      const loserIndex = winnerIndex === 1 ? 2 : 1;
      const winnerInvite = winnerIndex === 1 ? firstInvite : secondInvite;
      const loserInvite = loserIndex === 1 ? firstInvite : secondInvite;
      expect(
        (
          await prisma.groupMember.findUniqueOrThrow({
            where: { userId_groupId: { userId: users[winnerIndex]!, groupId } },
          })
        ).role,
      ).toBe(winnerIndex === 1 ? "ADMIN" : "MEMBER");
      await expect(
        caller(users[winnerIndex]!).groupInvites.accept({
          inviteId: winnerInvite.id,
          nextEpoch: winnerIndex === 1 ? firstEpoch : secondEpoch,
        }),
      ).rejects.toThrow("Invite not found");
      expect(await caller(users[loserIndex]!).groupInvites.list()).toHaveLength(1);
      const retry = await caller(users[loserIndex]!).groupInvites.acceptanceContext({
        inviteId: loserInvite.id,
      });
      const retryEpoch = bundle(
        createNextGroupEpoch({
          createdByDeviceId: `${users[loserIndex]}-device`,
          previousEpoch: retry.latestEpoch!,
          recipients: retry.recipients,
        }),
      );
      await caller(users[loserIndex]!).groupInvites.accept({
        inviteId: loserInvite.id,
        nextEpoch: retryEpoch,
      });
      const epochs = await prisma.groupEpoch.findMany({
        where: { groupId },
        orderBy: { epochNumber: "asc" },
        include: { recipientKeys: true },
      });
      expect(epochs.map((epoch) => epoch.epochNumber)).toEqual([1, 2, 3]);
      expect(epochs[2]!.recipientKeys.map((key) => key.recipientDeviceId).sort()).toEqual(
        users
          .slice(0, 3)
          .map((id) => `${id}-device`)
          .sort(),
      );
      expect(await owner.groupInvites.joinAlerts()).toHaveLength(2);
      await owner.groupInvites.send({
        groupId,
        invites: [
          { email: email(users[1]!), role: "MEMBER" },
          { email: email(users[3]!), role: "MEMBER" },
        ],
      });
      expect(await first.groupInvites.list()).toHaveLength(0);
      const declined = (await outsider.groupInvites.list())[0]!;
      await outsider.groupInvites.decline({ inviteId: declined.id });
      await expect(outsider.groupInvites.decline({ inviteId: declined.id })).rejects.toThrow(
        "Invite not found",
      );
      await expect(
        outsider.groupInvites.acceptanceContext({ inviteId: declined.id }),
      ).rejects.toThrow("Invite not found");
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(3);

      await owner.groupInvites.send({
        groupId,
        invites: [{ email: email(users[3]!), role: "MEMBER" }],
      });
      const racingInvite = (await outsider.groupInvites.list())[0]!;
      const racingContext = await outsider.groupInvites.acceptanceContext({
        inviteId: racingInvite.id,
      });
      const racingEpoch = bundle(
        createNextGroupEpoch({
          createdByDeviceId: `${users[3]}-device`,
          previousEpoch: racingContext.latestEpoch!,
          recipients: racingContext.recipients,
        }),
      );
      const race = await Promise.allSettled([
        outsider.groupInvites.accept({ inviteId: racingInvite.id, nextEpoch: racingEpoch }),
        outsider.groupInvites.decline({ inviteId: racingInvite.id }),
      ]);
      expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const accepted = race[0]!.status === "fulfilled";
      expect(await prisma.groupMember.count({ where: { groupId, userId: users[3]! } })).toBe(
        accepted ? 1 : 0,
      );
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(accepted ? 4 : 3);
      expect(await outsider.groupInvites.list()).toHaveLength(0);
    }, 30_000);
  },
);
