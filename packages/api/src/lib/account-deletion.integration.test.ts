import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createSecurityAlerts } from "@openbeacon/auth/securityAlerts.ts";
import { prisma } from "@openbeacon/database";
import type { SecurityAlert } from "@openbeacon/email";
import { deleteAccountRecords } from "./account-deletion.ts";
import { holdRowLock } from "./databaseLocks.testUtil.ts";

const prefix = `account-deletion-${crypto.randomUUID()}`;
const deletedUser = `${prefix}-deleted`;
const remainingUser = `${prefix}-remaining`;
const groupId = `${prefix}-group`;
const deletedDevice = `${prefix}-device-deleted`;
const remainingDevice = `${prefix}-device-remaining`;
const epochId = `${prefix}-epoch`;
const sent: { to: string; alert: SecurityAlert; hasPassword: boolean }[] = [];
let sendFailure: Error | null = null;
const tasks: Promise<unknown>[] = [];
const securityAlerts = createSecurityAlerts({
  db: prisma,
  sendSecurityAlertEmail: async ({ to, alert, hasPassword }) => {
    if (sendFailure) throw sendFailure;
    sent.push({ to, alert, hasPassword });
  },
  runInBackground: (task) => tasks.push(task),
});
const sentAlerts = async () => {
  await Promise.all(tasks.splice(0));
  return sent.splice(0);
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "account deletion epoch references with PostgreSQL",
  () => {
    beforeEach(async () => {
      await sentAlerts();
      sendFailure = null;
    });

    beforeAll(async () => {
      await prisma.user.createMany({
        data: [
          { id: deletedUser, name: "Deleted", email: `${deletedUser}@example.test` },
          { id: remainingUser, name: "Remaining", email: `${remainingUser}@example.test` },
        ],
      });
      await prisma.userDevice.createMany({
        data: [
          {
            id: deletedDevice,
            userId: deletedUser,
            publicKey: "a",
            publicKeyAlgorithm: "X25519",
            name: "Phone",
            icon: "phone",
          },
          {
            id: remainingDevice,
            userId: remainingUser,
            publicKey: "b",
            publicKeyAlgorithm: "X25519",
            name: "Phone",
            icon: "phone",
          },
        ],
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Group",
          image: `https://cdn.example/bucket/user/${deletedUser}/uploads/group/${groupId}/avatar/a`,
          groupMembers: {
            create: [
              { userId: deletedUser, role: "OWNER", joinedEpochNumber: 1 },
              { userId: remainingUser, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      const members = await prisma.groupMember.findMany({ where: { groupId } });
      const deletedMember = members.find((member) => member.userId === deletedUser);
      const remainingMember = members.find((member) => member.userId === remainingUser);
      if (!deletedMember || !remainingMember) throw new Error("Missing group members");
      await prisma.personalGroupNickname.createMany({
        data: [
          {
            ownerId: deletedMember.id,
            targetId: remainingMember.id,
            ciphertext: "owned-by-deleted",
          },
          {
            ownerId: remainingMember.id,
            targetId: deletedMember.id,
            ciphertext: "targets-deleted",
          },
          { ownerId: remainingMember.id, targetId: remainingMember.id, ciphertext: "remaining" },
        ],
      });
      await prisma.personalGroupColor.createMany({
        data: [
          { ownerId: deletedMember.id, ciphertext: "owned-by-deleted" },
          { ownerId: remainingMember.id, ciphertext: "remaining" },
        ],
      });
      await prisma.groupSharedInvite.create({
        data: {
          groupId,
          creatorId: deletedUser,
          codeHash: `${prefix}-invite`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await prisma.groupJoinAlert.create({
        data: { groupId, recipientId: remainingUser, memberId: deletedUser, memberName: "Deleted" },
      });
      await prisma.feedback.createMany({
        data: [
          { userId: deletedUser, message: `${prefix}-feedback`, email: null },
          { message: `${prefix}-feedback-anonymous`, email: `${deletedUser}@example.test` },
          {
            message: `${prefix}-feedback-mixed-case`,
            email: `${deletedUser.toUpperCase()}@Example.Test`,
          },
          { message: `${prefix}-feedback-other`, email: `${remainingUser}@example.test` },
        ],
      });
      await prisma.groupEpoch.create({
        data: {
          id: epochId,
          groupId,
          epochNumber: 1,
          createdByDeviceId: deletedDevice,
          senderPublicKey: "a",
        },
      });
      await prisma.recoveryKey.create({
        data: { userId: deletedUser, publicKey: "r", algorithm: "X25519", derivationVersion: 1 },
      });
      await prisma.accountHistoryKey.createMany({
        data: [deletedUser, remainingUser].map((userId) => ({
          id: `${userId}-history`,
          userId,
          version: 1,
          publicKey: "h",
          algorithm: "X25519",
          escrowEnc: "e",
          escrowCiphertext: "c",
          escrowAlgorithm: "a",
        })),
      });
      await prisma.groupEpochHistoryWrap.createMany({
        data: [
          {
            groupEpochId: epochId,
            historyKeyId: `${deletedUser}-history`,
            senderDeviceId: remainingDevice,
            senderPublicKey: "b",
            wrappedKey: "w",
            ephemeralPublicKey: "e",
            algorithm: "a",
          },
          {
            groupEpochId: epochId,
            historyKeyId: `${remainingUser}-history`,
            senderDeviceId: deletedDevice,
            senderPublicKey: "a",
            wrappedKey: "w",
            ephemeralPublicKey: "e",
            algorithm: "a",
          },
        ],
      });
      await prisma.groupEncryptedPayload.createMany({
        data: [
          {
            groupId,
            epochId,
            senderDeviceId: deletedDevice,
            senderUserId: deletedUser,
            kind: "location",
            algorithm: "a",
            nonce: "a",
            ciphertext: "a",
            clientPointId: "a",
          },
          {
            groupId,
            epochId,
            senderDeviceId: remainingDevice,
            senderUserId: remainingUser,
            kind: "location",
            algorithm: "a",
            nonce: "b",
            ciphertext: "b",
            clientPointId: "b",
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.feedback.deleteMany({
        where: { message: { startsWith: `${prefix}-feedback` } },
      });
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: [deletedUser, remainingUser] } } });
      await prisma.accountDeletionCleanup.deleteMany({ where: { userId: deletedUser } });
      await prisma.$disconnect();
    });

    test("new alerts and shared invitations require an account reference", async () => {
      await expect(
        Promise.resolve(
          prisma.groupJoinAlert.create({
            data: { groupId, recipientId: remainingUser, memberName: "Missing" },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        Promise.resolve(
          prisma.groupSharedInvite.create({
            data: {
              groupId,
              codeHash: `${prefix}-missing`,
              expiresAt: new Date(Date.now() + 60_000),
            },
          }),
        ),
      ).rejects.toThrow();
    });

    test("removing a sender and their location data preserves the epoch and other sender's data", async () => {
      const input = {
        db: prisma,
        userId: deletedUser,
        mode: "immediate" as const,
        imageUrlPrefix: "https://cdn.example/bucket",
        securityAlerts,
      };
      await expect(deleteAccountRecords(input)).rejects.toThrow("Transfer ownership");
      expect(await prisma.user.findUnique({ where: { id: deletedUser } })).not.toBeNull();
      expect(
        await prisma.groupEncryptedPayload.count({ where: { senderUserId: deletedUser } }),
      ).toBe(1);
      expect(await sentAlerts()).toEqual([]);
      await prisma.groupMember.update({
        where: { userId_groupId: { userId: remainingUser, groupId } },
        data: { role: "OWNER" },
      });
      await expect(deleteAccountRecords(input)).resolves.toBe(true);
      expect(await sentAlerts()).toEqual([
        {
          to: `${deletedUser}@example.test`,
          alert: { type: "account-deleted" },
          hasPassword: false,
        },
      ]);
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        epochRotationRequired: true,
        image: null,
      });
      expect(
        await prisma.accountDeletionCleanup.findUnique({ where: { userId: deletedUser } }),
      ).not.toBeNull();
      expect(await prisma.groupSharedInvite.count({ where: { groupId } })).toBe(0);
      expect(
        await prisma.personalGroupNickname.findMany({ where: { owner: { groupId } } }),
      ).toMatchObject([{ ciphertext: "remaining" }]);
      expect(
        await prisma.personalGroupColor.findMany({ where: { owner: { groupId } } }),
      ).toMatchObject([{ ciphertext: "remaining" }]);
      expect(await prisma.groupJoinAlert.count({ where: { groupId } })).toBe(0);
      expect(
        await prisma.feedback.findMany({
          where: { message: { startsWith: `${prefix}-feedback` } },
          select: { message: true },
        }),
      ).toEqual([{ message: `${prefix}-feedback-other` }]);
      expect(await prisma.groupEpoch.findUniqueOrThrow({ where: { id: epochId } })).toMatchObject({
        createdByDeviceId: null,
      });
      expect(await prisma.groupEncryptedPayload.findMany({ where: { groupId } })).toMatchObject([
        { senderUserId: remainingUser, senderDeviceId: remainingDevice },
      ]);
      expect(await prisma.recoveryKey.count({ where: { userId: deletedUser } })).toBe(0);
      expect(await prisma.accountHistoryKey.count({ where: { userId: deletedUser } })).toBe(0);
      expect(
        await prisma.groupEpochHistoryWrap.findMany({
          where: { groupEpochId: epochId },
          select: { historyKeyId: true, senderDeviceId: true, senderPublicKey: true },
        }),
      ).toEqual([
        { historyKeyId: `${remainingUser}-history`, senderDeviceId: null, senderPublicKey: "a" },
      ]);
    });
    test("scheduled deletion uses the database deadline and is idempotent", async () => {
      const id = `${prefix}-clock`;
      await prisma.user.create({
        data: { id, name: "Clock", email: `${id}@example.test`, pendingDeletion: true },
      });
      try {
        await prisma.$executeRaw`UPDATE "User" SET "deletionDate" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 hour' WHERE id = ${id}`;
        const input = {
          db: prisma,
          userId: id,
          imageUrlPrefix: "https://cdn.example/bucket",
          mode: "scheduled" as const,
          securityAlerts,
        };
        expect(await deleteAccountRecords(input)).toBe(false);
        expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
        expect(await sentAlerts()).toEqual([]);
        expect(
          await prisma.accountDeletionCleanup.findUnique({ where: { userId: id } }),
        ).toBeNull();
        await prisma.$executeRaw`UPDATE "User" SET "deletionDate" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${id}`;
        expect(await deleteAccountRecords(input)).toBe(true);
        expect(await deleteAccountRecords(input)).toBe(false);
        expect(await sentAlerts()).toEqual([
          { to: `${id}@example.test`, alert: { type: "account-deleted" }, hasPassword: false },
        ]);
        const cleanup = await prisma.accountDeletionCleanup.findUniqueOrThrow({
          where: { userId: id },
        });
        const [clock] = await prisma.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        expect(clock).toBeDefined();
        expect(Math.abs(clock!.now.getTime() - cleanup.createdAt.getTime())).toBeLessThan(10_000);
      } finally {
        await prisma.user.deleteMany({ where: { id } });
        await prisma.accountDeletionCleanup.deleteMany({ where: { userId: id } });
      }
    });

    test("deletes a sole member's group and records its image for storage cleanup", async () => {
      const id = `${prefix}-solo`;
      const soloGroup = `${prefix}-solo-group`;
      const imageKey = `user/someone-else/uploads/group/${soloGroup}/avatar/image.webp`;
      await prisma.user.create({ data: { id, name: "Solo", email: `${id}@example.test` } });
      await prisma.group.create({
        data: {
          id: soloGroup,
          name: "Solo group",
          image: `https://cdn.example/bucket/${imageKey}`,
          groupMembers: { create: { userId: id, role: "OWNER", joinedEpochNumber: 1 } },
        },
      });
      try {
        expect(
          await deleteAccountRecords({
            db: prisma,
            userId: id,
            mode: "immediate",
            imageUrlPrefix: "https://cdn.example/bucket",
            securityAlerts: null,
          }),
        ).toBe(true);
        expect(await prisma.group.findUnique({ where: { id: soloGroup } })).toBeNull();
        expect(
          (await prisma.accountDeletionCleanup.findUniqueOrThrow({ where: { userId: id } }))
            .imageKeys,
        ).toContain(imageKey);
      } finally {
        await prisma.group.deleteMany({ where: { id: soloGroup } });
        await prisma.user.deleteMany({ where: { id } });
        await prisma.accountDeletionCleanup.deleteMany({ where: { userId: id } });
      }
    });

    test("concurrent deletion cannot remove both group owners", async () => {
      const first = `${prefix}-owner-one`;
      const second = `${prefix}-owner-two`;
      const member = `${prefix}-owner-member`;
      const sharedGroup = `${prefix}-owners-group`;
      await prisma.user.createMany({
        data: [
          { id: first, name: "One", email: `${first}@example.test` },
          { id: second, name: "Two", email: `${second}@example.test` },
          { id: member, name: "Member", email: `${member}@example.test` },
        ],
      });
      await prisma.group.create({
        data: {
          id: sharedGroup,
          name: "Owners",
          groupMembers: {
            create: [
              { userId: first, role: "OWNER", joinedEpochNumber: 1 },
              { userId: second, role: "OWNER", joinedEpochNumber: 1 },
              { userId: member, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      try {
        const outcomes = await Promise.allSettled(
          [first, second].map((id) =>
            deleteAccountRecords({
              db: prisma,
              userId: id,
              mode: "immediate",
              imageUrlPrefix: "https://cdn.example/bucket",
              securityAlerts: null,
            }),
          ),
        );
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
        expect(
          await prisma.groupMember.count({ where: { groupId: sharedGroup, role: "OWNER" } }),
        ).toBe(1);
      } finally {
        await prisma.group.deleteMany({ where: { id: sharedGroup } });
        await prisma.user.deleteMany({ where: { id: { in: [first, second, member] } } });
        await prisma.accountDeletionCleanup.deleteMany({
          where: { userId: { in: [first, second] } },
        });
      }
    });

    test("waits for an upload from another of the account's phones", async () => {
      const id = `${prefix}-uploading`;
      const partner = `${prefix}-uploading-partner`;
      const uploadGroup = `${prefix}-uploading-group`;
      const device = `${prefix}-uploading-device`;
      await prisma.user.createMany({
        data: [
          { id, name: "Uploading", email: `${id}@example.test` },
          { id: partner, name: "Partner", email: `${partner}@example.test` },
        ],
      });
      await prisma.userDevice.create({
        data: {
          id: device,
          userId: id,
          publicKey: "u",
          publicKeyAlgorithm: "X25519",
          name: "Phone",
          icon: "phone",
        },
      });
      await prisma.group.create({
        data: {
          id: uploadGroup,
          name: "Uploads",
          groupMembers: {
            create: [
              { userId: id, role: "OWNER", joinedEpochNumber: 1 },
              { userId: partner, role: "OWNER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      const epoch = await prisma.groupEpoch.create({
        data: {
          id: `${uploadGroup}-epoch`,
          groupId: uploadGroup,
          epochNumber: 1,
          senderPublicKey: "u",
        },
      });
      try {
        const upload = await holdRowLock({
          db: prisma,
          id: uploadGroup,
          table: "Group",
          beforeCommit: (tx) =>
            tx.groupEncryptedPayload.create({
              data: {
                groupId: uploadGroup,
                epochId: epoch.id,
                senderDeviceId: device,
                senderUserId: id,
                kind: "location",
                algorithm: "a",
                nonce: "u",
                ciphertext: "u",
                clientPointId: "u",
              },
            }),
        });
        const deleting = deleteAccountRecords({
          db: prisma,
          userId: id,
          mode: "immediate",
          imageUrlPrefix: "https://cdn.example/bucket",
          securityAlerts: null,
        });
        await upload.waitForWaiters(1);
        await upload.release();

        expect(await deleting).toBe(true);
        expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
        expect(await prisma.groupEncryptedPayload.count({ where: { groupId: uploadGroup } })).toBe(
          0,
        );
      } finally {
        await prisma.group.deleteMany({ where: { id: uploadGroup } });
        await prisma.user.deleteMany({ where: { id: { in: [id, partner] } } });
        await prisma.accountDeletionCleanup.deleteMany({ where: { userId: id } });
      }
    });

    test("a failed account deleted alert doesn't fail the deletion", async () => {
      const id = `${prefix}-send-failure`;
      await prisma.user.create({
        data: {
          id,
          name: "Send failure",
          email: `${id}@example.test`,
          pendingDeletion: true,
          deletionDate: new Date(Date.now() - 60_000),
        },
      });
      sendFailure = new Error("SMTP is down");
      try {
        expect(
          await deleteAccountRecords({
            db: prisma,
            userId: id,
            mode: "scheduled",
            imageUrlPrefix: "https://cdn.example/bucket",
            securityAlerts,
          }),
        ).toBe(true);
        expect(await sentAlerts()).toEqual([]);
        expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
      } finally {
        await prisma.user.deleteMany({ where: { id } });
        await prisma.accountDeletionCleanup.deleteMany({ where: { userId: id } });
      }
    });
  },
);
