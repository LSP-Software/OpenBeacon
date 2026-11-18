import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  createNextGroupEpoch,
} from "@openbeacon/encryption";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupSettingsRouter } from "./groupSettingsRouter.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
  groupSettings: groupSettingsRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `shared-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const users = [0, 1, 2].map((i) => `${prefix}-${i}`);
const keys = users.map(() => createDeviceKeyPair());
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
const notMember = { code: "FORBIDDEN", message: "You are not a member of this group" };
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
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
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
      await prisma.group.deleteMany({ where: { id: { in: [groupId, `${prefix}-roles`] } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });
    test("a plain member can't create or check shared invites or change the group picture", async () => {
      const rolesGroupId = `${prefix}-roles`;
      await prisma.group.create({
        data: {
          id: rolesGroupId,
          name: "Roles",
          groupMembers: {
            create: [
              { userId: users[0]!, role: "OWNER", joinedEpochNumber: 1 },
              { userId: users[1]!, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      const member = caller(users[1]!);
      const calls: (() => Promise<unknown>)[] = [
        () => member.groupInvites.createShared({ groupId: rolesGroupId }),
        () => member.groupInvites.sharedStatuses({ groupId: rolesGroupId, inviteIds: ["any"] }),
        () => member.groupSettings.requestGroupImageUpload({ groupId: rolesGroupId }),
        () =>
          member.groupSettings.presignGroupImageUpload({
            groupId: rolesGroupId,
            fileName: crypto.randomUUID(),
            fileSize: 1024,
            contentHash: Buffer.alloc(32).toString("base64"),
          }),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: "You are not an admin of this group",
        });
      }
      expect(await prisma.groupSharedInvite.count({ where: { groupId: rolesGroupId } })).toBe(0);
      expect(await prisma.pendingUpload.count({ where: { userId: users[1]! } })).toBe(0);
    });

    test("outsiders can't create or check invites; expiry and code hashing are enforced", async () => {
      await expect(caller(users[1]!).groupInvites.createShared({ groupId })).rejects.toMatchObject(
        notMember,
      );
      const created = await caller(users[0]!).groupInvites.createShared({ groupId });
      expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(295_000);
      expect(created.expiresInMs).toBeGreaterThan(295_000);
      expect(created.expiresInMs).toBeLessThanOrEqual(300_000);
      expect(
        await caller(users[0]!).groupInvites.sharedStatuses({ groupId, inviteIds: [created.id] }),
      ).toEqual([{ id: created.id, status: "active" }]);
      await expect(
        caller(users[1]!).groupInvites.sharedStatuses({ groupId, inviteIds: [created.id] }),
      ).rejects.toMatchObject(notMember);
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
      expect(await prisma.groupEvent.count({ where: { groupId, type: "MEMBER_JOINED" } })).toBe(0);
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
      expect(
        await prisma.groupEvent.findMany({
          where: { groupId, type: "MEMBER_JOINED" },
          select: { type: true, subjectUserId: true, role: true },
        }),
      ).toEqual([{ type: "MEMBER_JOINED", subjectUserId: winner, role: "MEMBER" }]);
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
