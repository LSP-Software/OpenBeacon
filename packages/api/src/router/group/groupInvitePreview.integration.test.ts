import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { createDeviceKeyPair, createInitialGroupEpoch } from "@openbeacon/encryption";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";

const router = createTRPCRouter({
  groupInvites: groupInvitesRouter,
  groupLifecycle: groupLifecycleRouter,
});
const cache = createIntegrationTestCache(() => 0);
const prefix = `preview-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const [owner, guest, stranger] = [0, 1, 2].map((i) => `${prefix}-${i}`) as [string, string, string];
const ownerKey = createDeviceKeyPair();
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
const codeHash = (code: string) => createHash("sha256").update(code).digest("hex");

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group invite previews with PostgreSQL",
  () => {
    beforeAll(async () => {
      for (const userId of [owner, guest, stranger]) {
        const key = userId === owner ? ownerKey : createDeviceKeyPair();
        await prisma.user.create({
          data: {
            id: userId,
            name: `Name ${userId}`,
            email: `${userId}@example.test`,
            image: userId === owner ? "https://images.example.test/owner.png" : null,
          },
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
            publicKey: key.publicKey,
            publicKeyAlgorithm: key.algorithm,
            name: "Phone",
            icon: "phone",
            activatedAt: new Date(),
          },
        });
      }
      const device = await prisma.userDevice.findUniqueOrThrow({
        where: { id: `${owner}-device` },
      });
      const initial = createInitialGroupEpoch({
        creator: { deviceId: device.id, privateKey: ownerKey.privateKey },
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
      await caller(owner).groupLifecycle.create({
        groupId,
        name: "Smith Family",
        initialEpoch: {
          createdByDeviceId: initial.epoch.createdByDeviceId,
          epochId: initial.epoch.epochId,
          epochNumber: initial.epoch.epochNumber,
          historyKeys: [],
          recipientKeys: initial.wrappedKeys,
        },
      });
    });
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: [owner, guest, stranger] } } });
      await prisma.$disconnect();
    });

    test("a valid code shows the group and its creator without using the code", async () => {
      const { code, id } = await caller(owner).groupInvites.createShared({ groupId });
      expect(await caller(guest).groupInvites.sharedPreview({ code: code.toLowerCase() })).toEqual({
        group: { id: groupId, name: "Smith Family", image: null, memberCount: 1 },
        inviter: { name: `Name ${owner}`, image: "https://images.example.test/owner.png" },
        alreadyMember: false,
        joinBlockedBy: null,
      });
      expect((await prisma.groupSharedInvite.findUniqueOrThrow({ where: { id } })).usedAt).toBe(
        null,
      );
      expect(await caller(owner).groupInvites.sharedPreview({ code })).toMatchObject({
        alreadyMember: true,
        joinBlockedBy: null,
      });
    });

    test("unknown, used, expired and orphaned codes all look the same", async () => {
      const notFound = { code: "NOT_FOUND", message: "Invite is invalid or expired" };
      await expect(
        caller(guest).groupInvites.sharedPreview({ code: "0".repeat(32) }),
      ).rejects.toMatchObject(notFound);

      const used = await caller(owner).groupInvites.createShared({ groupId });
      await prisma.groupSharedInvite.update({
        where: { codeHash: codeHash(used.code) },
        data: { usedAt: new Date() },
      });
      await expect(
        caller(guest).groupInvites.sharedPreview({ code: used.code }),
      ).rejects.toMatchObject(notFound);

      const expired = await caller(owner).groupInvites.createShared({ groupId });
      await prisma.groupSharedInvite.update({
        where: { codeHash: codeHash(expired.code) },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      await expect(
        caller(guest).groupInvites.sharedPreview({ code: expired.code }),
      ).rejects.toMatchObject(notFound);

      const orphaned = await caller(owner).groupInvites.createShared({ groupId });
      await prisma.groupSharedInvite.update({
        where: { codeHash: codeHash(orphaned.code) },
        data: { creatorId: stranger },
      });
      await expect(
        caller(guest).groupInvites.sharedPreview({ code: orphaned.code }),
      ).rejects.toMatchObject(notFound);
    });

    test("an email invite is shown only to its recipient while it is live", async () => {
      const invite = await prisma.groupMemberInvite.create({
        data: { groupId, inviterId: owner, recipientId: guest, role: "MEMBER" },
      });
      expect(await caller(guest).groupInvites.preview({ inviteId: invite.id })).toEqual({
        group: { id: groupId, name: "Smith Family", image: null, memberCount: 1 },
        inviter: { name: `Name ${owner}`, image: "https://images.example.test/owner.png" },
        alreadyMember: false,
        joinBlockedBy: null,
      });
      await expect(
        caller(stranger).groupInvites.preview({ inviteId: invite.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await prisma.groupMemberInvite.update({
        where: { id: invite.id },
        data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) },
      });
      await expect(
        caller(guest).groupInvites.preview({ inviteId: invite.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("a guest at the group limit is told before joining, and pending deletion wins", async () => {
      const fillerIds = Array.from({ length: 16 }, (_, i) => `${prefix}-filler-${i}`);
      await prisma.group.createMany({
        data: fillerIds.map((id) => ({ id, name: "Filler" })),
      });
      await prisma.groupMember.createMany({
        data: fillerIds.map((id) => ({
          groupId: id,
          userId: guest,
          role: "MEMBER" as const,
          joinedEpochNumber: 0,
        })),
      });
      try {
        const { code } = await caller(owner).groupInvites.createShared({ groupId });
        expect(await caller(guest).groupInvites.sharedPreview({ code })).toMatchObject({
          alreadyMember: false,
          joinBlockedBy: "GROUP_LIMIT",
        });

        await prisma.user.update({ where: { id: guest }, data: { pendingDeletion: true } });
        expect(await caller(guest).groupInvites.sharedPreview({ code })).toMatchObject({
          joinBlockedBy: "PENDING_DELETION",
        });
      } finally {
        await prisma.user.update({ where: { id: guest }, data: { pendingDeletion: false } });
        await prisma.group.deleteMany({ where: { id: { in: fillerIds } } });
      }
    });

    test("a guest pending deletion is told before joining", async () => {
      await prisma.groupMemberInvite.deleteMany({ where: { groupId, recipientId: guest } });
      const invite = await prisma.groupMemberInvite.create({
        data: { groupId, inviterId: owner, recipientId: guest, role: "MEMBER" },
      });
      await prisma.user.update({ where: { id: guest }, data: { pendingDeletion: true } });
      try {
        expect(await caller(guest).groupInvites.preview({ inviteId: invite.id })).toMatchObject({
          alreadyMember: false,
          joinBlockedBy: "PENDING_DELETION",
        });
      } finally {
        await prisma.user.update({ where: { id: guest }, data: { pendingDeletion: false } });
        await prisma.groupMemberInvite.delete({ where: { id: invite.id } });
      }
    });
  },
);
