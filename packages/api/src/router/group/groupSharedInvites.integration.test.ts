import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OpenBeaconCache } from "@openbeacon/cache";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
} from "@openbeacon/encryption";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
});
const cache = new OpenBeaconCache({
  redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  keyPrefix: `test-${crypto.randomUUID()}`,
  now: () => 0,
});
const prefix = `shared-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const users = [0, 1, 2].map((i) => `${prefix}-${i}`);
const keys = users.map(() => createDeviceKeyPair());
const caller = (userId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id: userId }, session: { id: `${userId}-session` } },
  } as Parameters<typeof router.createCaller>[0]);
const bundle = (result: ReturnType<typeof createInitialGroupEpoch>) => ({
  createdByDeviceId: result.epoch.createdByDeviceId,
  epochId: result.epoch.epochId,
  epochNumber: result.epoch.epochNumber,
  historyKeys: [],
  recipientKeys: result.wrappedKeys,
});

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "shared group invitations with PostgreSQL",
  () => {
    beforeAll(async () => {
      for (const [i, userId] of users.entries()) {
        await prisma.user.create({
          data: { id: userId, name: userId, email: `${userId}@example.test` },
        });
        await prisma.session.create({
          data: {
            id: `${userId}-session`,
            token: `${userId}-token`,
            userId,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await prisma.userDevice.create({
          data: {
            id: `${userId}-device`,
            userId,
            publicKey: keys[i]!.publicKey,
            publicKeyAlgorithm: keys[i]!.algorithm,
          },
        });
      }
      const device = await prisma.userDevice.findUniqueOrThrow({
        where: { id: `${users[0]}-device` },
      });
      const initial = createInitialGroupEpoch({
        creator: { deviceId: device.id, privateKey: keys[0]!.privateKey },
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
    test("only admins can create; expiry and code hashing are enforced", async () => {
      await expect(caller(users[1]!).groupInvites.createShared({ groupId })).rejects.toThrow();
      const created = await caller(users[0]!).groupInvites.createShared({ groupId });
      expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(295_000);
      expect(created.expiresInMs).toBeGreaterThan(295_000);
      expect(created.expiresInMs).toBeLessThanOrEqual(300_000);
      expect(
        await caller(users[0]!).groupInvites.sharedStatuses({ groupId, inviteIds: [created.id] }),
      ).toEqual([{ id: created.id, status: "active" }]);
      await expect(
        caller(users[1]!).groupInvites.sharedStatuses({ groupId, inviteIds: [created.id] }),
      ).rejects.toThrow();
      expect(
        await caller(users[0]!).groupInvites.sharedStatuses({ groupId, inviteIds: ["missing"] }),
      ).toEqual([]);
      const stored = await prisma.groupSharedInvite.findUniqueOrThrow({
        where: { codeHash: createHash("sha256").update(created.code).digest("hex") },
      });
      expect(stored.codeHash).not.toBe(created.code);
      const context = await caller(users[1]!).groupInvites.sharedAcceptanceContext({
        code: created.code.toLowerCase(),
      });
      const next = createNextGroupEpoch({
        creator: { deviceId: `${users[1]}-device`, privateKey: keys[1]!.privateKey },
        previousEpoch: context.latestEpoch!,
        recipients: context.recipients,
      });
      await expect(
        caller(users[0]!).groupInvites.sharedAcceptanceContext({ code: created.code }),
      ).rejects.toThrow();
      await prisma.groupSharedInvite.update({
        where: { id: stored.id },
        data: { expiresAt: new Date(0) },
      });
      expect(
        await caller(users[0]!).groupInvites.sharedStatuses({ groupId, inviteIds: [created.id] }),
      ).toEqual([{ id: created.id, status: "expired" }]);
      await expect(
        caller(users[1]!).groupInvites.sharedAcceptanceContext({ code: created.code }),
      ).rejects.toThrow();
      await expect(
        caller(users[1]!).groupInvites.acceptShared({
          code: created.code,
          nextEpoch: bundle(next),
        }),
      ).rejects.toThrow();
      expect(await prisma.groupMember.count({ where: { groupId } })).toBe(1);
      await expect(
        caller(users[1]!).groupInvites.sharedAcceptanceContext({ code: "0".repeat(32) }),
      ).rejects.toThrow();
    });
    test("a code is consumed once and a failed epoch rolls back consumption", async () => {
      await prisma.groupMemberInvite.createMany({
        data: users
          .slice(1)
          .map((recipientId) => ({ groupId, recipientId, inviterId: users[0]!, role: "MEMBER" })),
      });
      const { code, id } = await caller(users[0]!).groupInvites.createShared({ groupId });
      const replacement = await caller(users[0]!).groupInvites.createShared({ groupId });
      const context = await caller(users[1]!).groupInvites.sharedAcceptanceContext({ code });
      const joined = createNextGroupEpoch({
        creator: { deviceId: `${users[1]}-device`, privateKey: keys[1]!.privateKey },
        previousEpoch: context.latestEpoch!,
        recipients: context.recipients,
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      await expect(
        caller(users[1]!).groupInvites.acceptShared({
          code,
          nextEpoch: { ...bundle(joined), epochNumber: 999 },
        }),
      ).rejects.toThrow();
      expect(
        (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).epochRotationRequired,
      ).toBe(true);
      expect(
        await caller(users[0]!).groupInvites.sharedStatuses({ groupId, inviteIds: [id] }),
      ).toEqual([{ id, status: "active" }]);
      expect(await caller(users[0]!).groupInvites.joinAlerts()).toHaveLength(0);
      expect(await prisma.groupMemberInvite.count({ where: { groupId } })).toBe(2);
      const otherContext = await caller(users[2]!).groupInvites.sharedAcceptanceContext({ code });
      const other = createNextGroupEpoch({
        creator: { deviceId: `${users[2]}-device`, privateKey: keys[2]!.privateKey },
        previousEpoch: otherContext.latestEpoch!,
        recipients: otherContext.recipients,
      });
      const results = await Promise.allSettled([
        caller(users[1]!).groupInvites.acceptShared({ code, nextEpoch: bundle(joined) }),
        caller(users[2]!).groupInvites.acceptShared({ code, nextEpoch: bundle(other) }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(
        (await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).epochRotationRequired,
      ).toBe(false);
      expect(await prisma.groupMember.count({ where: { groupId } })).toBe(2);
      expect(await prisma.groupEpoch.count({ where: { groupId } })).toBe(2);
      expect(
        await prisma.groupMember.findMany({
          where: { groupId, userId: { not: users[0]! } },
          select: { joinedEpochNumber: true },
        }),
      ).toEqual([{ joinedEpochNumber: 2 }]);
      expect(
        await caller(users[0]!).groupInvites.sharedStatuses({ groupId, inviteIds: [id] }),
      ).toEqual([{ id, status: "used" }]);
      expect(
        await caller(users[0]!).groupInvites.sharedStatuses({
          groupId,
          inviteIds: [id, replacement.id],
        }),
      ).toEqual(
        expect.arrayContaining([
          { id, status: "used" },
          { id: replacement.id, status: "active" },
        ]),
      );
      const winner = results[0]!.status === "fulfilled" ? users[1]! : users[2]!;
      await expect(
        caller(winner).groupInvites.sharedStatuses({ groupId, inviteIds: [id] }),
      ).rejects.toThrow();
      expect(
        await prisma.groupMemberInvite.findUnique({
          where: { recipientId_groupId: { recipientId: winner, groupId } },
        }),
      ).toBeNull();
      expect(await prisma.groupMemberInvite.count({ where: { groupId } })).toBe(1);
      const alerts = await caller(users[0]!).groupInvites.joinAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.memberName).toBe(winner);
      expect(await caller(winner).groupInvites.joinAlerts()).toHaveLength(0);
      await caller(winner).groupInvites.dismissJoinAlert({ id: alerts[0]!.id });
      expect(await caller(users[0]!).groupInvites.joinAlerts()).toHaveLength(1);
      await caller(users[0]!).groupInvites.dismissJoinAlert({ id: alerts[0]!.id });
      expect(await caller(users[0]!).groupInvites.joinAlerts()).toHaveLength(0);
      const epochs = await prisma.groupEpoch.findMany({
        where: { groupId },
        orderBy: { epochNumber: "asc" },
        include: { recipientKeys: true },
      });
      expect(
        epochs[0]!.recipientKeys.some((key) => key.recipientDeviceId === `${winner}-device`),
      ).toBe(false);
      expect(
        epochs[1]!.recipientKeys.some((key) => key.recipientDeviceId === `${winner}-device`),
      ).toBe(true);
      expect(
        (
          await prisma.groupMember.findUniqueOrThrow({
            where: { userId_groupId: { userId: winner, groupId } },
          })
        ).role,
      ).toBe("MEMBER");
      await expect(
        caller(users[1]!).groupInvites.sharedAcceptanceContext({ code }),
      ).rejects.toThrow();
    }, 30_000);
  },
);
