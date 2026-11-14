import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import { tryCatch } from "@openbeacon/shared";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { env } from "../../env.ts";
import { storedWebpResponse } from "../../lib/storedWebp.testUtil.ts";
import { DevicePendingError } from "../../lib/deviceActivation.ts";
import { DeviceUnverifiedError } from "../../lib/deviceUnverified.ts";
import { buildGroupAvatarPath, setPendingImageUploadForUser } from "../../lib/image-upload.ts";
import { buildImagePublicUrl } from "../../lib/storage.ts";
import { s3Client } from "../../s3client.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { removeGroupMemberWithOwnerGuard } from "./assertGroupMemberCanBeRemoved.ts";
import { groupEpochRouter } from "./groupEpochRouter.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupSettingsRouter } from "./groupSettingsRouter.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";

const router = createTRPCRouter({
  groupEpoch: groupEpochRouter,
  groupLifecycle: groupLifecycleRouter,
  groupInvites: groupInvitesRouter,
  groupMembership: groupMembershipRouter,
  groupSettings: groupSettingsRouter,
});
let now = 0;
const cache = createIntegrationTestCache(() => now);
const prefix = `settings-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const users = [0, 1, 2].map((n) => `${prefix}-${n}`);
const caller = (
  userId: string,
  device: { deviceId: string | null; unverifiedDeviceId: string | null } = {
    deviceId: `${userId}-device`,
    unverifiedDeviceId: null,
  },
) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      ...device,
      session: { user: { id: userId } },
    }) as Parameters<typeof router.createCaller>[0],
  );
const unopenableEpoch = (createdByDeviceId: string) => {
  const epochId = crypto.randomUUID();
  return {
    createdByDeviceId,
    epochId,
    epochNumber: 1,
    historyKeys: [],
    recipientKeys: [
      {
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
        createdAt: new Date(),
        ephemeralPublicKey: Buffer.alloc(32).toString("base64"),
        epochId,
        recipientDeviceId: createdByDeviceId,
        senderPublicKey: Buffer.alloc(32).toString("base64"),
        wrappedKey: Buffer.alloc(48).toString("base64"),
      },
    ],
  };
};

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "group settings with PostgreSQL",
  () => {
    beforeEach(() => {
      now += 60_000;
    });
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
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
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Original",
          groupMembers: {
            create: users.map((userId, index) => ({
              userId,
              role: index < 2 ? "OWNER" : "MEMBER",
              joinedEpochNumber: 1,
            })),
          },
        },
      });
    });
    afterAll(async () => {
      await prisma.group.deleteMany({ where: { id: groupId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });
    test("last member deletion rejects groups with other members and deletes a sole member's group", async () => {
      const lastMemberGroupId = `${prefix}-last-member`;
      await prisma.group.create({
        data: {
          id: lastMemberGroupId,
          name: "Last member",
          groupMembers: {
            create: [
              { userId: users[0]!, role: "OWNER", joinedEpochNumber: 1 },
              { userId: users[2]!, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      await expect(
        caller(users[0]!).groupLifecycle.delete({
          groupId: lastMemberGroupId,
          onlyIfLastMember: true,
        }),
      ).rejects.toThrow("The group has other members");
      expect(await prisma.group.findUnique({ where: { id: lastMemberGroupId } })).not.toBeNull();
      await prisma.groupMember.deleteMany({
        where: { groupId: lastMemberGroupId, userId: users[2] },
      });
      await caller(users[0]!).groupLifecycle.delete({
        groupId: lastMemberGroupId,
        onlyIfLastMember: true,
      });
      expect(await prisma.group.findUnique({ where: { id: lastMemberGroupId } })).toBeNull();
    });
    test("enforces permissions and serializes competing owner demotions", async () => {
      const members = await prisma.groupMember.findMany({ where: { groupId } });
      const first = members.find((member) => member.userId === users[0])!;
      const second = members.find((member) => member.userId === users[1])!;
      const ordinary = caller(users[2]!);
      await expect(ordinary.groupSettings.rename({ groupId, name: "No" })).rejects.toThrow(
        "Only owners and admins can rename the group.",
      );
      await expect(ordinary.groupLifecycle.delete({ groupId })).rejects.toThrow(
        "You are not the owner of this group",
      );
      await expect(
        ordinary.groupMembership.updateRole({ groupId, memberId: first.id, role: "MEMBER" }),
      ).rejects.toThrow("Only owners can change roles.");
      await caller(users[0]!).groupSettings.rename({ groupId, name: " Renamed " });
      expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).name).toBe(
        "Renamed",
      );
      const outcomes = await Promise.allSettled([
        caller(users[0]!).groupMembership.updateRole({
          groupId,
          memberId: first.id,
          role: "MEMBER",
        }),
        caller(users[1]!).groupMembership.updateRole({
          groupId,
          memberId: second.id,
          role: "MEMBER",
        }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.groupMember.count({ where: { groupId, role: "OWNER" } })).toBe(1);
    });

    test("freezes pending roles and preserves an owner who can manage the group", async () => {
      const protectedGroup = `${prefix}-pending-owner`;
      const joinGroup = `${prefix}-pending-join`;
      const pendingUser = users[1]!;
      const activeUser = users[0]!;
      await prisma.group.create({
        data: {
          id: protectedGroup,
          name: "Protected",
          groupMembers: {
            create: [
              { userId: activeUser, role: "OWNER", joinedEpochNumber: 1 },
              { userId: pendingUser, role: "OWNER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      await prisma.group.create({
        data: {
          id: joinGroup,
          name: "Join",
          groupMembers: { create: { userId: activeUser, role: "OWNER", joinedEpochNumber: 1 } },
        },
      });
      await prisma.user.update({
        where: { id: pendingUser },
        data: { pendingDeletion: true, deletionDate: new Date(Date.now() + 60_000) },
      });
      try {
        const members = await prisma.groupMember.findMany({ where: { groupId: protectedGroup } });
        const active = members.find((member) => member.userId === activeUser)!;
        const pending = members.find((member) => member.userId === pendingUser)!;
        await expect(
          caller(activeUser).groupMembership.updateRole({
            groupId: protectedGroup,
            memberId: pending.id,
            role: "MEMBER",
          }),
        ).rejects.toThrow("pending deletion");
        await expect(
          caller(activeUser).groupMembership.updateRole({
            groupId: protectedGroup,
            memberId: active.id,
            role: "MEMBER",
          }),
        ).rejects.toThrow("at least one owner");
        await expect(
          prisma.$transaction((tx) =>
            removeGroupMemberWithOwnerGuard({
              db: tx,
              groupId: protectedGroup,
              memberId: active.id,
            }),
          ),
        ).rejects.toThrow("only owner");
        await prisma.groupMember.update({ where: { id: pending.id }, data: { role: "MEMBER" } });
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
        await expect(
          caller(activeUser).groupMembership.remove({
            groupId: protectedGroup,
            memberId: active.id,
            successorMemberId: pending.id,
            nextEpoch,
          }),
        ).rejects.toThrow("pending deletion");
        const shared = await caller(activeUser).groupInvites.createShared({ groupId: joinGroup });
        await expect(
          caller(pendingUser).groupInvites.acceptShared({ code: shared.code, nextEpoch }),
        ).rejects.toThrow("pending deletion");
        const invite = await prisma.groupMemberInvite.create({
          data: {
            groupId: joinGroup,
            inviterId: activeUser,
            recipientId: pendingUser,
            role: "MEMBER",
          },
        });
        await expect(
          caller(pendingUser).groupInvites.accept({ inviteId: invite.id, nextEpoch }),
        ).rejects.toThrow("pending deletion");
        expect(
          await prisma.groupMember.count({ where: { groupId: joinGroup, userId: pendingUser } }),
        ).toBe(0);
        await prisma.user.update({
          where: { id: pendingUser },
          data: { pendingDeletion: false, deletionDate: null },
        });
        await expect(
          caller(activeUser).groupMembership.updateRole({
            groupId: protectedGroup,
            memberId: pending.id,
            role: "ADMIN",
          }),
        ).resolves.toMatchObject({ role: "ADMIN" });
      } finally {
        await prisma.user.update({
          where: { id: pendingUser },
          data: { pendingDeletion: false, deletionDate: null },
        });
        await prisma.group.deleteMany({ where: { id: { in: [protectedGroup, joinGroup] } } });
      }
    });

    test("only an owner can delete a group image and a storage failure leaves the group", async () => {
      const imageGroupId = `${prefix}-image-group`;
      const path = `user/${users[0]}/uploads/group/${imageGroupId}/avatar`;
      await prisma.group.create({
        data: {
          id: imageGroupId,
          name: "Image group",
          image: buildImagePublicUrl(env.IMAGES_S3_BUCKET_NAME, path, "avatar.webp"),
          groupMembers: {
            create: [
              { userId: users[0]!, role: "OWNER", joinedEpochNumber: 1 },
              { userId: users[2]!, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
      });
      const send = spyOn(s3Client, "send");
      try {
        await expect(
          caller(users[2]!).groupLifecycle.delete({ groupId: imageGroupId }),
        ).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();

        send.mockRejectedValue(new Error("Storage unavailable"));
        await expect(
          caller(users[0]!).groupLifecycle.delete({ groupId: imageGroupId }),
        ).rejects.toThrow();
        expect(await prisma.group.findUnique({ where: { id: imageGroupId } })).not.toBeNull();

        send.mockReset();
        send.mockResolvedValue({ $metadata: {} });
        await caller(users[0]!).groupLifecycle.delete({ groupId: imageGroupId });
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectVersionsCommand);
        expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
        expect((send.mock.calls[1]?.[0] as DeleteObjectCommand | undefined)?.input).toEqual({
          Bucket: env.IMAGES_S3_BUCKET_NAME,
          Key: `${path}/avatar.webp`,
        });
        expect(await prisma.group.findUnique({ where: { id: imageGroupId } })).toBeNull();
      } finally {
        send.mockRestore();
        await prisma.group.deleteMany({ where: { id: imageGroupId } });
      }
    });

    test("removes already-uploaded pending images when deleting a group", async () => {
      const pendingGroupId = `${prefix}-pending-group`;
      await prisma.group.create({
        data: {
          id: pendingGroupId,
          name: "Pending image",
          groupMembers: { create: { userId: users[0]!, role: "OWNER", joinedEpochNumber: 1 } },
        },
      });
      await prisma.pendingUpload.create({
        data: {
          userId: users[0]!,
          uploadType: "groupAvatar",
          groupId: pendingGroupId,
          fileName: "pending.webp",
        },
      });
      const send = spyOn(s3Client, "send").mockResolvedValue({ $metadata: {} });
      try {
        await caller(users[0]!).groupLifecycle.delete({ groupId: pendingGroupId });
        expect((send.mock.calls[1]?.[0] as DeleteObjectCommand | undefined)?.input).toEqual({
          Bucket: env.IMAGES_S3_BUCKET_NAME,
          Key: `user/${users[0]}/uploads/group/${pendingGroupId}/avatar/pending.webp`,
        });
        expect(await prisma.group.findUnique({ where: { id: pendingGroupId } })).toBeNull();
        expect(await prisma.pendingUpload.count({ where: { groupId: pendingGroupId } })).toBe(0);
      } finally {
        send.mockRestore();
        await prisma.group.deleteMany({ where: { id: pendingGroupId } });
        await prisma.pendingUpload.deleteMany({ where: { groupId: pendingGroupId } });
      }
    });

    test("cleans up a direct upload confirmed after group deletion", async () => {
      const uploadGroupId = `${prefix}-upload-race`;
      await prisma.group.create({
        data: {
          id: uploadGroupId,
          name: "Upload race",
          groupMembers: { create: { userId: users[0]!, role: "OWNER", joinedEpochNumber: 1 } },
        },
      });
      await prisma.pendingUpload.create({
        data: {
          userId: users[0]!,
          uploadType: "groupAvatar",
          groupId: uploadGroupId,
          fileName: "race.webp",
        },
      });
      const lateKey = `user/${users[0]}/uploads/group/${uploadGroupId}/avatar/race.webp`;
      const send = spyOn(s3Client, "send").mockImplementation(async (command) =>
        command instanceof ListObjectVersionsCommand &&
        command.input.Prefix === `user/${users[0]}/uploads/group/${uploadGroupId}/avatar/`
          ? { $metadata: {}, Versions: [{ Key: lateKey, VersionId: "late" }] }
          : { $metadata: {} },
      );
      try {
        await caller(users[0]!).groupLifecycle.delete({ groupId: uploadGroupId });
        expect(await prisma.pendingUpload.count({ where: { groupId: uploadGroupId } })).toBe(0);
        send.mockClear();
        await expect(
          caller(users[2]!).groupSettings.confirmGroupImageUpload({ groupId: uploadGroupId }),
        ).rejects.toThrow("No pending group image upload to confirm.");
        expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectsCommand)).toBe(
          false,
        );
        send.mockClear();
        await expect(
          caller(users[0]!).groupSettings.confirmGroupImageUpload({ groupId: uploadGroupId }),
        ).rejects.toThrow("No pending group image upload to confirm.");
        const deleted = send.mock.calls.find(
          ([command]) => command instanceof DeleteObjectsCommand,
        )?.[0] as DeleteObjectsCommand | undefined;
        expect(deleted?.input.Delete?.Objects).toEqual([{ Key: lateKey, VersionId: "late" }]);
      } finally {
        send.mockRestore();
        await prisma.group.deleteMany({ where: { id: uploadGroupId } });
        await prisma.pendingUpload.deleteMany({ where: { groupId: uploadGroupId } });
      }
    });

    test("keeps pending uploads for different groups separate", async () => {
      const groupIds = [`${prefix}-first-upload`, `${prefix}-second-upload`];
      const userId = users[0]!;
      for (const id of groupIds) {
        await prisma.group.create({
          data: {
            id,
            name: "Upload test",
            groupMembers: { create: { userId, role: "OWNER", joinedEpochNumber: 1 } },
          },
        });
      }
      const send = spyOn(s3Client, "send").mockImplementation(async (command) =>
        storedWebpResponse(command),
      );
      try {
        await Promise.all(
          groupIds.map((id) =>
            setPendingImageUploadForUser({
              db: prisma,
              userId,
              uploadType: "groupAvatar",
              fileName: `${id}.webp`,
              groupId: id,
              bucketName: env.IMAGES_S3_BUCKET_NAME,
              currentImagePath: buildGroupAvatarPath(userId, id),
            }),
          ),
        );
        expect(
          await prisma.pendingUpload.count({ where: { userId, uploadType: "groupAvatar" } }),
        ).toBe(2);
        for (const id of groupIds) {
          const result = await caller(userId).groupSettings.confirmGroupImageUpload({
            groupId: id,
          });
          expect((await prisma.group.findUniqueOrThrow({ where: { id } })).image).toBe(
            result.imageUrl,
          );
        }
        expect(
          await prisma.pendingUpload.count({ where: { userId, uploadType: "groupAvatar" } }),
        ).toBe(0);
      } finally {
        send.mockRestore();
        await prisma.pendingUpload.deleteMany({
          where: { groupId: { in: groupIds } },
        });
        await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      }
    });

    test("confirms a direct upload for an admin", async () => {
      const uploadGroupId = `${prefix}-upload-success`;
      await prisma.group.create({
        data: {
          id: uploadGroupId,
          name: "Upload success",
          groupMembers: { create: { userId: users[0]!, role: "OWNER", joinedEpochNumber: 1 } },
        },
      });
      await prisma.pendingUpload.create({
        data: {
          userId: users[0]!,
          uploadType: "groupAvatar",
          groupId: uploadGroupId,
          fileName: "success.webp",
        },
      });
      const send = spyOn(s3Client, "send").mockImplementation(async (command) =>
        storedWebpResponse(command),
      );
      try {
        const result = await caller(users[0]!).groupSettings.confirmGroupImageUpload({
          groupId: uploadGroupId,
        });
        expect((await prisma.group.findUniqueOrThrow({ where: { id: uploadGroupId } })).image).toBe(
          result.imageUrl,
        );
        expect(
          await prisma.pendingUpload.findUnique({
            where: {
              userId_uploadType_groupId: {
                userId: users[0]!,
                uploadType: "groupAvatar",
                groupId: uploadGroupId,
              },
            },
          }),
        ).toBeNull();
      } finally {
        send.mockRestore();
        await prisma.group.deleteMany({ where: { id: uploadGroupId } });
        await prisma.pendingUpload.deleteMany({ where: { groupId: uploadGroupId } });
      }
    });

    test("admins cannot remove owners or admins or invite admins, and members cannot invite", async () => {
      const permissionGroupId = `${prefix}-permission-group`;
      const group = await prisma.group.create({
        data: {
          id: permissionGroupId,
          name: "Permissions",
          groupMembers: {
            create: [
              { userId: users[0]!, role: "OWNER", joinedEpochNumber: 1 },
              { userId: users[1]!, role: "ADMIN", joinedEpochNumber: 1 },
              { userId: users[2]!, role: "ADMIN", joinedEpochNumber: 1 },
            ],
          },
        },
        include: { groupMembers: true },
      });
      const owner = group.groupMembers.find((member) => member.userId === users[0]);
      expect(owner).toBeDefined();
      const admin = group.groupMembers.find((member) => member.userId === users[1]);
      expect(admin).toBeDefined();
      const removal = {
        groupId: permissionGroupId,
        memberId: owner!.id,
        nextEpoch: {
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
        },
      };
      await expect(caller(users[2]!).groupMembership.remove(removal)).rejects.toThrow(
        "Only owners can remove owners or admins.",
      );
      await expect(
        caller(users[2]!).groupMembership.remove({ ...removal, memberId: admin!.id }),
      ).rejects.toThrow("Only owners can remove owners or admins.");
      await expect(
        caller(users[2]!).groupInvites.send({
          groupId: permissionGroupId,
          invites: [{ email: "person@example.test", role: "ADMIN" }],
        }),
      ).rejects.toThrow("Only owners can invite admins.");
      await expect(
        caller(users[2]!).groupInvites.send({
          groupId: permissionGroupId,
          invites: [{ email: "person@example.test", role: "MEMBER" }],
        }),
      ).resolves.toBeDefined();
      await prisma.groupMember.update({
        where: { userId_groupId: { userId: users[2]!, groupId: permissionGroupId } },
        data: { role: "MEMBER" },
      });
      await expect(
        caller(users[2]!).groupInvites.send({
          groupId: permissionGroupId,
          invites: [{ email: "person@example.test", role: "MEMBER" }],
        }),
      ).rejects.toThrow();
      await prisma.group.delete({ where: { id: permissionGroupId } });
    });

    test("a phone that isn't set up can't read or change the group", async () => {
      const lockedGroupId = `${prefix}-not-set-up`;
      const [owner, member] = [users[0]!, users[2]!];
      await prisma.userDevice.create({
        data: {
          icon: "phone",
          id: `${owner}-pending`,
          name: "New phone",
          publicKey: "pending-key",
          publicKeyAlgorithm: "X25519",
          userId: owner,
        },
      });
      const group = await prisma.group.create({
        data: {
          id: lockedGroupId,
          name: "Locked",
          groupMembers: {
            create: [
              { userId: owner, role: "OWNER", joinedEpochNumber: 1 },
              { userId: member, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
        include: { groupMembers: true },
      });
      const memberId = group.groupMembers.find(({ userId }) => userId === member)!.id;
      const ownerMemberId = group.groupMembers.find(({ userId }) => userId === owner)!.id;
      try {
        for (const [api, cause] of [
          [
            caller(owner, { deviceId: `${owner}-pending`, unverifiedDeviceId: null }),
            DevicePendingError,
          ],
          [
            caller(owner, { deviceId: null, unverifiedDeviceId: `${owner}-device` }),
            DeviceUnverifiedError,
          ],
        ] as const) {
          const attempts = [
            () => api.groupMembership.list(),
            () => api.groupMembership.get({ groupId: lockedGroupId }),
            () => api.groupMembership.members({ groupId: lockedGroupId }),
            () => api.groupMembership.listMemberDevices({ groupId: lockedGroupId }),
            () => api.groupMembership.nicknames({ groupId: lockedGroupId }),
            () => api.groupMembership.colors(),
            () => api.groupMembership.removalContext({ groupId: lockedGroupId, memberId }),
            () =>
              api.groupMembership.updateNickname({
                groupId: lockedGroupId,
                memberId,
                ciphertext: "nickname",
                expectedCiphertext: null,
              }),
            () => api.groupMembership.updateColor({ groupId: lockedGroupId, ciphertext: "color" }),
            () =>
              api.groupMembership.remove({
                groupId: lockedGroupId,
                memberId,
                nextEpoch: unopenableEpoch(`${owner}-device`),
              }),
            () =>
              api.groupMembership.remove({
                groupId: lockedGroupId,
                memberId: ownerMemberId,
                nextEpoch: unopenableEpoch(`${owner}-device`),
              }),
            () =>
              api.groupMembership.updateRole({ groupId: lockedGroupId, memberId, role: "ADMIN" }),
            () => api.groupSettings.rename({ groupId: lockedGroupId, name: "Taken" }),
            () => api.groupSettings.confirmGroupImageUpload({ groupId: lockedGroupId }),
          ];
          for (const attempt of attempts) {
            const { error } = await tryCatch(attempt());
            expect(error).toMatchObject({ code: "FORBIDDEN" });
            expect((error as { cause?: unknown }).cause).toBeInstanceOf(cause);
          }
        }
        const after = await prisma.group.findUniqueOrThrow({
          where: { id: lockedGroupId },
          include: { groupMembers: true },
        });
        expect(after.name).toBe("Locked");
        expect(after.groupMembers.map(({ role }) => role).sort()).toEqual(["MEMBER", "OWNER"]);
        expect(
          await prisma.personalGroupNickname.count({ where: { ownerId: ownerMemberId } }),
        ).toBe(0);
        expect(await prisma.personalGroupColor.count({ where: { ownerId: ownerMemberId } })).toBe(
          0,
        );
        expect(await prisma.groupEpoch.count({ where: { groupId: lockedGroupId } })).toBe(0);
      } finally {
        await prisma.group.deleteMany({ where: { id: lockedGroupId } });
        await prisma.userDevice.deleteMany({ where: { id: `${owner}-pending` } });
      }
    }, 30_000);

    test("an epoch must be made by the phone that sends it, not another phone on the account", async () => {
      const claimedGroupId = `${prefix}-claimed`;
      const [owner, member] = [users[0]!, users[2]!];
      await prisma.userDevice.create({
        data: {
          activatedAt: new Date(),
          icon: "phone",
          id: `${owner}-other`,
          name: "Other phone",
          publicKey: "other-key",
          publicKeyAlgorithm: "X25519",
          userId: owner,
        },
      });
      const group = await prisma.group.create({
        data: {
          epochRotationRequired: true,
          id: claimedGroupId,
          name: "Claimed",
          groupMembers: {
            create: [
              { userId: owner, role: "OWNER", joinedEpochNumber: 1 },
              { userId: member, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
        },
        include: { groupMembers: true },
      });
      const memberId = group.groupMembers.find(({ userId }) => userId === member)!.id;
      try {
        const api = caller(owner);
        await expect(
          api.groupEpoch.rotate({
            groupId: claimedGroupId,
            nextEpoch: unopenableEpoch(`${owner}-other`),
          }),
        ).rejects.toThrow("Group keys must be created by this phone.");
        await expect(
          api.groupMembership.remove({
            groupId: claimedGroupId,
            memberId,
            nextEpoch: unopenableEpoch(`${owner}-other`),
          }),
        ).rejects.toThrow("Group keys must be created by this phone.");
        const after = await prisma.group.findUniqueOrThrow({
          where: { id: claimedGroupId },
          include: { groupMembers: true },
        });
        expect(after.epochRotationRequired).toBe(true);
        expect(after.groupMembers).toHaveLength(2);
        expect(await prisma.groupEpoch.count({ where: { groupId: claimedGroupId } })).toBe(0);
      } finally {
        await prisma.group.deleteMany({ where: { id: claimedGroupId } });
        await prisma.userDevice.deleteMany({ where: { id: `${owner}-other` } });
      }
    });
  },
);
