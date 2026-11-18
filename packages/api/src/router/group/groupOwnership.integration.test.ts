import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { beginAccountDeletion, deleteAccountRecords } from "../../lib/account-deletion.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupOwnershipRouter } from "./groupOwnershipRouter.ts";

const router = createTRPCRouter({
  groupLifecycle: groupLifecycleRouter,
  groupMembership: groupMembershipRouter,
  groupOwnership: groupOwnershipRouter,
});
let now = 0;
const cache = createIntegrationTestCache(() => now);
const prefix = `ownership-${crypto.randomUUID()}`;
const [owner, admin, otherAdmin, editor, member] = [
  "owner",
  "admin",
  "other-admin",
  "editor",
  "member",
].map((name) => `${prefix}-${name}`) as [string, string, string, string, string];
const users = [owner, admin, otherAdmin, editor, member];
const groupIds: string[] = [];
const caller = (userId: string) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId: `${userId}-device`,
      session: { user: { id: userId } },
    }) as Parameters<typeof router.createCaller>[0],
  );
const nextEpoch = {
  createdByDeviceId: "device",
  epochId: "epoch",
  epochNumber: 1,
  historyKeys: [],
  recipientKeys: [
    {
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date(),
      ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
      epochId: "epoch",
      recipientDeviceId: "device",
      senderPublicKey: Buffer.alloc(32).toString("base64"),
      wrappedKey: Buffer.alloc(48).toString("base64"),
    },
  ],
};
const seedGroup = async (name: string) => {
  const groupId = `${prefix}-${name}`;
  groupIds.push(groupId);
  const group = await prisma.group.create({
    data: {
      id: groupId,
      name,
      ownerId: owner,
      groupMembers: {
        create: [
          { userId: owner, role: "ADMIN" as const },
          { userId: admin, role: "ADMIN" as const },
          { userId: otherAdmin, role: "ADMIN" as const },
          { userId: editor, role: "EDITOR" as const },
          { userId: member, role: "MEMBER" as const },
        ].map((row) => ({ ...row, joinedEpochNumber: 1 })),
      },
    },
    include: { groupMembers: true },
  });
  const memberIdOf = (userId: string) =>
    group.groupMembers.find((row) => row.userId === userId)!.id;
  return { groupId, memberIdOf };
};
const ownership = (groupId: string) =>
  prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { ownerId: true, ownershipOfferedToId: true, ownershipOfferedAt: true },
  });
const ownerGuard = { code: "FORBIDDEN", cause: { reason: "GROUP_OWNER" } };
const offerGone = { code: "CONFLICT", cause: { reason: "OWNERSHIP_OFFER_GONE" } };

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group ownership with PostgreSQL",
  () => {
    beforeEach(() => {
      now += 60_000;
    });
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({
          id,
          name: id.slice(prefix.length + 1),
          email: `${id}@example.test`,
        })),
      });
      await prisma.userDevice.createMany({
        data: users.map((userId) => ({
          activatedAt: new Date(),
          icon: "phone" as const,
          id: `${userId}-device`,
          name: "Phone",
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
          userId,
        })),
      });
    });
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    test("an Admin can't remove or demote the owner, and an Editor can't remove an Admin", async () => {
      const { groupId, memberIdOf } = await seedGroup("guards");
      await expect(
        caller(admin).groupMembership.remove({ groupId, memberId: memberIdOf(owner), nextEpoch }),
      ).rejects.toMatchObject({
        ...ownerGuard,
        message: "The group's owner can't be removed from the group.",
      });
      for (const role of ["EDITOR", "MEMBER"] as const) {
        await expect(
          caller(admin).groupMembership.updateRole({ groupId, memberId: memberIdOf(owner), role }),
        ).rejects.toMatchObject(ownerGuard);
      }
      await expect(
        caller(editor).groupMembership.remove({ groupId, memberId: memberIdOf(admin), nextEpoch }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only Admins can remove Admins or Editors.",
      });
      await expect(
        caller(editor).groupMembership.updateRole({
          groupId,
          memberId: memberIdOf(member),
          role: "EDITOR",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only Admins can change roles." });
      expect(
        await prisma.groupMember.findMany({
          where: { groupId, userId: { in: [owner, admin] } },
          select: { role: true },
        }),
      ).toEqual([{ role: "ADMIN" }, { role: "ADMIN" }]);
      expect((await ownership(groupId)).ownerId).toBe(owner);
    });

    test("only the owner can delete the group", async () => {
      const { groupId } = await seedGroup("deletion");
      await expect(caller(admin).groupLifecycle.delete({ groupId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await prisma.group.count({ where: { id: groupId } })).toBe(1);
      await caller(owner).groupLifecycle.delete({ groupId });
      expect(await prisma.group.count({ where: { id: groupId } })).toBe(0);
    });

    test("the owner can't leave through remove", async () => {
      const { groupId, memberIdOf } = await seedGroup("leaving");
      await expect(
        caller(owner).groupMembership.remove({ groupId, memberId: memberIdOf(owner), nextEpoch }),
      ).rejects.toMatchObject({
        ...ownerGuard,
        message: "The owner can't leave the group. Transfer ownership or delete the group.",
      });
      expect(await prisma.groupMember.count({ where: { groupId, userId: owner } })).toBe(1);
    });

    test("a transfer only happens once the new owner accepts it", async () => {
      const { groupId, memberIdOf } = await seedGroup("transfer");
      await expect(
        caller(admin).groupOwnership.offer({ groupId, memberId: memberIdOf(otherAdmin) }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await caller(owner).groupOwnership.offer({ groupId, memberId: memberIdOf(admin) });

      expect(await ownership(groupId)).toMatchObject({
        ownerId: owner,
        ownershipOfferedToId: admin,
        ownershipOfferedAt: expect.any(Date),
      });
      expect(
        await prisma.accountNotice.findMany({
          where: { groupId },
          select: { userId: true, type: true },
        }),
      ).toEqual([{ userId: admin, type: "OWNERSHIP_OFFERED" }]);
      expect(await caller(admin).groupOwnership.offers()).toEqual([
        {
          groupId,
          groupName: "transfer",
          owner: { userId: owner, name: "owner" },
          offeredAt: expect.any(Date),
          seats: 5,
        },
      ]);
      expect(await caller(otherAdmin).groupOwnership.offers()).toEqual([]);
      for (const userId of [otherAdmin, owner]) {
        await expect(caller(userId).groupOwnership.accept({ groupId })).rejects.toMatchObject(
          offerGone,
        );
      }
      await expect(caller(otherAdmin).groupOwnership.decline({ groupId })).rejects.toMatchObject(
        offerGone,
      );

      await caller(admin).groupOwnership.decline({ groupId });

      expect(await ownership(groupId)).toEqual({
        ownerId: owner,
        ownershipOfferedToId: null,
        ownershipOfferedAt: null,
      });
      await expect(caller(admin).groupOwnership.accept({ groupId })).rejects.toMatchObject(
        offerGone,
      );

      await caller(owner).groupOwnership.offer({ groupId, memberId: memberIdOf(admin) });
      await caller(admin).groupOwnership.accept({ groupId });

      expect(await ownership(groupId)).toEqual({
        ownerId: admin,
        ownershipOfferedToId: null,
        ownershipOfferedAt: null,
      });
      expect(
        (await prisma.groupMember.findUniqueOrThrow({ where: { id: memberIdOf(owner) } })).role,
      ).toBe("ADMIN");
      expect(
        await prisma.groupEvent.findMany({
          where: { groupId, type: "OWNER_CHANGED" },
          select: { actorUserId: true, subjectUserId: true },
        }),
      ).toEqual([{ actorUserId: admin, subjectUserId: owner }]);
      await expect(
        caller(owner).groupOwnership.offer({ groupId, memberId: memberIdOf(otherAdmin) }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(owner).groupLifecycle.delete({ groupId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller(admin).groupMembership.remove({ groupId, memberId: memberIdOf(admin), nextEpoch }),
      ).rejects.toMatchObject(ownerGuard);
    });

    test("ownership can only be offered to another Admin", async () => {
      const { groupId, memberIdOf } = await seedGroup("offer-targets");
      for (const userId of [editor, member, owner]) {
        await expect(
          caller(owner).groupOwnership.offer({ groupId, memberId: memberIdOf(userId) }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      expect((await ownership(groupId)).ownershipOfferedToId).toBeNull();
      expect(await prisma.accountNotice.count({ where: { groupId } })).toBe(0);
    });

    test("demoting the offered Admin or cancelling clears the offer", async () => {
      const { groupId, memberIdOf } = await seedGroup("offer-cleared");
      await caller(owner).groupOwnership.offer({ groupId, memberId: memberIdOf(admin) });
      await caller(otherAdmin).groupMembership.updateRole({
        groupId,
        memberId: memberIdOf(admin),
        role: "EDITOR",
      });
      expect((await ownership(groupId)).ownershipOfferedToId).toBeNull();
      await expect(caller(admin).groupOwnership.accept({ groupId })).rejects.toMatchObject(
        offerGone,
      );

      await caller(owner).groupOwnership.offer({ groupId, memberId: memberIdOf(otherAdmin) });
      await expect(caller(admin).groupOwnership.cancel({ groupId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await caller(owner).groupOwnership.cancel({ groupId });
      expect((await ownership(groupId)).ownershipOfferedToId).toBeNull();
      expect((await ownership(groupId)).ownerId).toBe(owner);
    });

    test("deleting an owner's account deletes the groups they own and keeps the ones they belong to", async () => {
      const leaving = `${prefix}-leaving`;
      const friend = `${prefix}-friend`;
      const ownedGroup = `${prefix}-owned-by-leaving`;
      const joinedGroup = `${prefix}-joined-by-leaving`;
      groupIds.push(ownedGroup, joinedGroup);
      await prisma.user.createMany({
        data: [leaving, friend].map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      try {
        await prisma.group.create({
          data: {
            id: ownedGroup,
            name: "Owned",
            ownerId: leaving,
            groupMembers: {
              create: [
                { userId: leaving, role: "ADMIN", joinedEpochNumber: 1 },
                { userId: friend, role: "ADMIN", joinedEpochNumber: 1 },
              ],
            },
          },
        });
        await prisma.group.create({
          data: {
            id: joinedGroup,
            name: "Joined",
            ownerId: friend,
            ownershipOfferedToId: leaving,
            ownershipOfferedAt: new Date(),
            groupMembers: {
              create: [
                { userId: friend, role: "ADMIN", joinedEpochNumber: 1 },
                { userId: leaving, role: "ADMIN", joinedEpochNumber: 1 },
              ],
            },
          },
        });
        await prisma.groupMemberInvite.create({
          data: { groupId: ownedGroup, inviterId: friend, recipientId: member, role: "MEMBER" },
        });

        await prisma.$transaction((tx) =>
          beginAccountDeletion(tx, { userId: leaving, delayHours: 168 }),
        );

        expect(await prisma.groupMemberInvite.count({ where: { groupId: ownedGroup } })).toBe(0);
        expect((await ownership(joinedGroup)).ownershipOfferedToId).toBeNull();
        expect(await prisma.group.count({ where: { id: ownedGroup } })).toBe(1);

        expect(
          await deleteAccountRecords({
            db: prisma,
            userId: leaving,
            mode: "immediate",
            imageUrlPrefix: "https://cdn.example/bucket",
            securityAlerts: null,
          }),
        ).toBe(true);

        expect(await prisma.group.count({ where: { id: ownedGroup } })).toBe(0);
        expect(await prisma.user.count({ where: { id: friend } })).toBe(1);
        expect(
          await prisma.group.findUniqueOrThrow({
            where: { id: joinedGroup },
            select: {
              ownerId: true,
              epochRotationRequired: true,
              groupMembers: { select: { userId: true } },
            },
          }),
        ).toEqual({
          ownerId: friend,
          epochRotationRequired: true,
          groupMembers: [{ userId: friend }],
        });
        expect(
          await prisma.groupEvent.count({
            where: { groupId: joinedGroup, type: "ACCOUNT_DELETED" },
          }),
        ).toBe(1);
      } finally {
        await prisma.group.deleteMany({ where: { id: { in: [ownedGroup, joinedGroup] } } });
        await prisma.accountDeletionCleanup.deleteMany({ where: { userId: leaving } });
        await prisma.user.deleteMany({ where: { id: { in: [leaving, friend] } } });
      }
    });
  },
);
