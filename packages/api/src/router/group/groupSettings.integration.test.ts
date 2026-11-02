import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { prisma } from "@openbeacon/database";
import { WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import { env } from "../../env.ts";
import { buildImagePublicUrl } from "../../lib/storage.ts";
import { s3Client } from "../../s3client.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { groupInvitesRouter } from "./groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupSettingsRouter } from "./groupSettingsRouter.ts";

class TestCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

const router = createTRPCRouter({
  groupLifecycle: groupLifecycleRouter,
  groupInvites: groupInvitesRouter,
  groupMembership: groupMembershipRouter,
  groupSettings: groupSettingsRouter,
});
let now = 0;
const cache = new TestCache({ redisUrl: "redis://localhost:6379", now: () => now });
const prefix = `settings-${crypto.randomUUID()}`;
const groupId = `${prefix}-group`;
const users = [0, 1, 2].map((n) => `${prefix}-${n}`);
const caller = (userId: string) =>
  router.createCaller({
    cache,
    db: prisma,
    clientIp: "127.0.0.1",
    session: { user: { id: userId } },
  } as Parameters<typeof router.createCaller>[0]);

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
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Original",
          groupMembers: {
            create: users.map((userId, index) => ({
              userId,
              role: index < 2 ? "OWNER" : "MEMBER",
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
              { userId: users[0]!, role: "OWNER" },
              { userId: users[2]!, role: "MEMBER" },
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
      await expect(ordinary.groupSettings.rename({ groupId, name: "No" })).rejects.toThrow();
      await expect(ordinary.groupLifecycle.delete({ groupId })).rejects.toThrow();
      await expect(
        ordinary.groupMembership.updateRole({ groupId, memberId: first.id, role: "MEMBER" }),
      ).rejects.toThrow();
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

    test("only an owner can delete a group image and a storage failure leaves the group", async () => {
      const imageGroupId = `${prefix}-image-group`;
      const path = `group/${imageGroupId}/uploads/avatar`;
      await prisma.group.create({
        data: {
          id: imageGroupId,
          name: "Image group",
          image: buildImagePublicUrl(env.S3_BUCKET_NAME, path, "avatar.webp"),
          groupMembers: {
            create: [
              { userId: users[0]!, role: "OWNER" },
              { userId: users[2]!, role: "MEMBER" },
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
          Bucket: env.S3_BUCKET_NAME,
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
          groupMembers: { create: { userId: users[0]!, role: "OWNER" } },
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
          Bucket: env.S3_BUCKET_NAME,
          Key: `group/${pendingGroupId}/uploads/avatar/pending.webp`,
        });
        expect(await prisma.group.findUnique({ where: { id: pendingGroupId } })).toBeNull();
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
          groupMembers: { create: { userId: users[0]!, role: "OWNER" } },
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
      const send = spyOn(s3Client, "send").mockImplementation(async (command) =>
        command instanceof HeadObjectCommand
          ? { $metadata: {}, ContentLength: 3 }
          : { $metadata: {} },
      );
      try {
        await caller(users[0]!).groupLifecycle.delete({ groupId: uploadGroupId });
        send.mockClear();
        await expect(
          caller(users[2]!).groupSettings.confirmGroupImageUpload({ groupId: uploadGroupId }),
        ).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
        await expect(
          caller(users[0]!).groupSettings.confirmGroupImageUpload({ groupId: uploadGroupId }),
        ).rejects.toThrow("Group no longer exists.");
        const deleted = send.mock.calls.find(
          ([command]) => command instanceof DeleteObjectCommand,
        )?.[0] as DeleteObjectCommand | undefined;
        expect(deleted?.input.Key).toBe(`group/${uploadGroupId}/uploads/avatar/race.webp`);
        expect(
          await prisma.pendingUpload.findUnique({
            where: { userId_uploadType: { userId: users[0]!, uploadType: "groupAvatar" } },
          }),
        ).toBeNull();
      } finally {
        send.mockRestore();
        await prisma.group.deleteMany({ where: { id: uploadGroupId } });
        await prisma.pendingUpload.deleteMany({ where: { groupId: uploadGroupId } });
      }
    });

    test("confirms a direct upload for an admin", async () => {
      const uploadGroupId = `${prefix}-upload-success`;
      await prisma.group.create({
        data: {
          id: uploadGroupId,
          name: "Upload success",
          groupMembers: { create: { userId: users[0]!, role: "OWNER" } },
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
        command instanceof HeadObjectCommand
          ? { $metadata: {}, ContentLength: 3 }
          : { $metadata: {} },
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
            where: { userId_uploadType: { userId: users[0]!, uploadType: "groupAvatar" } },
          }),
        ).toBeNull();
      } finally {
        send.mockRestore();
        await prisma.group.deleteMany({ where: { id: uploadGroupId } });
        await prisma.pendingUpload.deleteMany({ where: { groupId: uploadGroupId } });
      }
    });

    test("an admin cannot remove an owner and members cannot invite", async () => {
      const permissionGroupId = `${prefix}-permission-group`;
      const group = await prisma.group.create({
        data: {
          id: permissionGroupId,
          name: "Permissions",
          groupMembers: {
            create: [
              { userId: users[0]!, role: "OWNER" },
              { userId: users[1]!, role: "OWNER" },
              { userId: users[2]!, role: "ADMIN" },
            ],
          },
        },
        include: { groupMembers: true },
      });
      const owner = group.groupMembers.find((member) => member.userId === users[0]);
      expect(owner).toBeDefined();
      await expect(
        caller(users[2]!).groupMembership.remove({
          groupId: permissionGroupId,
          memberId: owner!.id,
          nextEpoch: {
            createdByDeviceId: "device",
            epochId: "epoch",
            epochNumber: 1,
            recipientKeys: [
              {
                algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
                createdAt: new Date(),
                ephemeralPublicKey: "key",
                epochId: "epoch",
                nonce: "nonce",
                recipientDeviceId: "device",
                wrappedKey: "key",
              },
            ],
          },
        }),
      ).rejects.toThrow("Only owners can remove another owner.");
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
  },
);
