import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { readFile } from "node:fs/promises";
import { createIntegrationTestCache } from "@openbeacon/cache/integration";
import { prisma } from "@openbeacon/database";
import {
  encryptImageKey,
  generateGroupEpochKey,
  generateImageKey,
  MIN_ENCRYPTED_IMAGE_LENGTH,
  type ImageKeyKind,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { env } from "../../env.ts";
import { deleteAccountRecords } from "../../lib/account-deletion.ts";
import { withDeviceActive } from "../../lib/deviceContext.testUtil.ts";
import { buildGroupAvatarPath, buildUserAvatarPath } from "../../lib/image-upload.ts";
import { imageKeyColumns, readImageKeysNeedCatchUp } from "../../lib/imageKeys.ts";
import { buildImagePublicUrl } from "../../lib/storage.ts";
import { storedEncryptedImageResponse } from "../../lib/storedEncryptedImage.testUtil.ts";
import { s3Client } from "../../s3client.ts";
import { createTRPCRouter } from "../../trpcRuntime.ts";
import { accountRouter } from "../accountRouter.ts";
import { groupImageKeysRouter } from "./groupImageKeysRouter.ts";
import { groupMembershipRouter } from "./groupMembershipRouter.ts";
import { groupSettingsRouter } from "./groupSettingsRouter.ts";

const router = createTRPCRouter({
  account: accountRouter,
  groupImageKeys: groupImageKeysRouter,
  groupMembership: groupMembershipRouter,
  groupSettings: groupSettingsRouter,
});
let now = 0;
const cache = createIntegrationTestCache(() => now);
const prefix = `image-keys-${crypto.randomUUID()}`;
const owner = `${prefix}-owner`;
const admin = `${prefix}-admin`;
const member = `${prefix}-member`;
const outsider = `${prefix}-outsider`;
const uploader = `${prefix}-uploader`;
const users = [owner, admin, member, outsider, uploader];
const deletedUploader = `${prefix}-deleted-uploader`;
const groupId = `${prefix}-group`;
const secondGroupId = `${prefix}-second-group`;
const otherGroupId = `${prefix}-other-group`;
const groupIds = [groupId, secondGroupId, otherGroupId];
const oldEpochId = `${prefix}-epoch-1`;
const latestEpochId = `${prefix}-epoch-2`;
const secondEpochId = `${prefix}-second-epoch`;
const otherEpochId = `${prefix}-other-epoch`;
const epochKey = generateGroupEpochKey();

const deviceOf = (userId: string) => `${userId}-device`;

const caller = (userId: string, deviceId = deviceOf(userId)) =>
  router.createCaller(
    withDeviceActive({
      cache,
      db: prisma,
      clientIp: "127.0.0.1",
      deviceId,
      unverifiedDeviceId: null,
      session: { user: { id: userId } },
    }) as Parameters<typeof router.createCaller>[0],
  );

const profileUrl = (userId: string, fileName: string) =>
  buildImagePublicUrl(env.IMAGES_S3_BUCKET_NAME, buildUserAvatarPath(userId), fileName);

const groupUrl = (userId: string, targetGroupId: string, fileName: string) =>
  buildImagePublicUrl(
    env.IMAGES_S3_BUCKET_NAME,
    buildGroupAvatarPath(userId, targetGroupId),
    fileName,
  );

const wrap = ({
  epochId = latestEpochId,
  fileName,
  kind,
  ownerId,
  senderUserId,
  targetGroupId = groupId,
}: {
  epochId?: string;
  fileName: string;
  kind: ImageKeyKind;
  ownerId: string;
  senderUserId: string;
  targetGroupId?: string;
}) =>
  encryptImageKey({
    epochId,
    epochKey,
    fileName,
    groupId: targetGroupId,
    imageKey: generateImageKey(),
    kind,
    ownerId,
    senderDeviceId: deviceOf(senderUserId),
  });

const memberRow = (userId: string, targetGroupId = groupId) =>
  prisma.groupMember.findUniqueOrThrow({
    where: { userId_groupId: { userId, groupId: targetGroupId } },
  });

const setProfilePicture = async (
  userId: string,
  {
    epochId = latestEpochId,
    targetGroupId = groupId,
  }: { epochId?: string; targetGroupId?: string } = {},
) => {
  const fileName = crypto.randomUUID();
  await prisma.user.update({
    where: { id: userId },
    data: { image: profileUrl(userId, fileName) },
  });
  const key = wrap({
    epochId,
    fileName,
    kind: "profile-image-key",
    ownerId: userId,
    senderUserId: userId,
    targetGroupId,
  });
  await prisma.groupMember.update({
    where: { userId_groupId: { userId, groupId: targetGroupId } },
    data: imageKeyColumns(key),
  });
  return { fileName, key };
};

const setGroupPicture = async ({ epochId = latestEpochId }: { epochId?: string } = {}) => {
  const fileName = crypto.randomUUID();
  const key = wrap({
    epochId,
    fileName,
    kind: "group-image-key",
    ownerId: groupId,
    senderUserId: admin,
  });
  await prisma.group.update({
    where: { id: groupId },
    data: { image: groupUrl(admin, groupId, fileName), ...imageKeyColumns(key) },
  });
  return { fileName, key };
};

const addPendingUpload = async (
  userId: string,
  uploadType: "userAvatar" | "groupAvatar",
  targetGroupId = "",
) => {
  const fileName = crypto.randomUUID();
  await prisma.pendingUpload.create({
    data: { userId, uploadType, groupId: targetGroupId, fileName },
  });
  return fileName;
};

const send = spyOn(s3Client, "send");

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "picture keys with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: users.map((id) => ({ id, name: id, email: `${id}@example.test` })),
      });
      await prisma.userDevice.createMany({
        data: users.map((userId) => ({
          activatedAt: new Date(),
          icon: "phone" as const,
          id: deviceOf(userId),
          name: "Phone",
          publicKey: "public-key",
          publicKeyAlgorithm: "X25519",
          userId,
        })),
      });
      await prisma.group.create({
        data: {
          id: groupId,
          name: "Family",
          groupMembers: {
            create: [
              { userId: owner, role: "OWNER", joinedEpochNumber: 1 },
              { userId: admin, role: "ADMIN", joinedEpochNumber: 1 },
              { userId: member, role: "MEMBER", joinedEpochNumber: 2 },
              { userId: uploader, role: "ADMIN", joinedEpochNumber: 1 },
            ],
          },
          groupEpochs: {
            create: [
              { id: oldEpochId, epochNumber: 1, senderPublicKey: "public-key" },
              { id: latestEpochId, epochNumber: 2, senderPublicKey: "public-key" },
            ],
          },
        },
      });
      await prisma.group.create({
        data: {
          id: secondGroupId,
          name: "Friends",
          groupMembers: {
            create: [
              { userId: owner, role: "OWNER", joinedEpochNumber: 1 },
              { userId: member, role: "MEMBER", joinedEpochNumber: 1 },
            ],
          },
          groupEpochs: {
            create: [{ id: secondEpochId, epochNumber: 1, senderPublicKey: "public-key" }],
          },
        },
      });
      await prisma.group.create({
        data: {
          id: otherGroupId,
          name: "Other",
          groupMembers: { create: [{ userId: outsider, role: "OWNER", joinedEpochNumber: 1 }] },
          groupEpochs: {
            create: [{ id: otherEpochId, epochNumber: 1, senderPublicKey: "public-key" }],
          },
        },
      });
    });

    beforeEach(async () => {
      now += 60_000;
      send.mockImplementation((async (command: unknown) =>
        storedEncryptedImageResponse(command)) as unknown as typeof s3Client.send);
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { image: null, imageKeySealed: null },
      });
      await prisma.group.updateMany({
        where: { id: { in: groupIds } },
        data: { image: null, epochRotationRequired: false, ...imageKeyColumns(null) },
      });
      await prisma.groupMember.updateMany({
        where: { groupId: { in: groupIds } },
        data: imageKeyColumns(null),
      });
      await prisma.pendingUpload.deleteMany({ where: { userId: { in: users } } });
    });

    afterEach(() => send.mockReset());

    afterAll(async () => {
      send.mockRestore();
      await prisma.pendingUpload.deleteMany({ where: { userId: { in: users } } });
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [...users, deletedUploader] } } });
      await prisma.$disconnect();
    });

    test("requesting an upload returns the file name before the app encrypts and presigns", async () => {
      const { fileName } = await caller(member).account.requestProfileImageUpload();
      const pending = await prisma.pendingUpload.findFirstOrThrow({ where: { userId: member } });
      expect(fileName).toBe(pending.fileName);
      expect(fileName).toMatch(/^[0-9a-f-]{36}$/);

      const { presignedUrl } = await caller(member).account.presignProfileImageUpload({
        fileName,
        fileSize: 1024,
        contentHash: Buffer.alloc(32).toString("base64"),
      });
      expect(new URL(presignedUrl).pathname).toEndWith(
        `/user/${member}/uploads/avatar/${fileName}`,
      );
    });

    test("presigning is refused for a file name that isn't the pending upload", async () => {
      await caller(member).account.requestProfileImageUpload();
      await expect(
        caller(member).account.presignProfileImageUpload({
          fileName: crypto.randomUUID(),
          fileSize: 1024,
          contentHash: Buffer.alloc(32).toString("base64"),
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const { fileName } = await caller(admin).groupSettings.requestGroupImageUpload({ groupId });
      await expect(
        caller(admin).groupSettings.presignGroupImageUpload({
          groupId: secondGroupId,
          fileName,
          fileSize: 1024,
          contentHash: Buffer.alloc(32).toString("base64"),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const { presignedUrl } = await caller(admin).groupSettings.presignGroupImageUpload({
        groupId,
        fileName,
        fileSize: 1024,
        contentHash: Buffer.alloc(32).toString("base64"),
      });
      expect(new URL(presignedUrl).pathname).toEndWith(
        `/user/${admin}/uploads/group/${groupId}/avatar/${fileName}`,
      );
    });

    test("presigning is refused outside the size limits", async () => {
      const { fileName } = await caller(member).account.requestProfileImageUpload();
      for (const fileSize of [MIN_ENCRYPTED_IMAGE_LENGTH - 1, env.MAX_IMAGE_FILE_SIZE + 1]) {
        await expect(
          caller(member).account.presignProfileImageUpload({
            fileName,
            fileSize,
            contentHash: Buffer.alloc(32).toString("base64"),
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    });

    test("an upload stays pinned to the picture it was first presigned for", async () => {
      const hash = (fill: number) => Buffer.alloc(32, fill).toString("base64");
      const { fileName } = await caller(member).account.requestProfileImageUpload();
      const presign = (contentHash: string, fileSize = 1024) =>
        caller(member).account.presignProfileImageUpload({ fileName, fileSize, contentHash });

      await presign(hash(1));
      await expect(presign(hash(1))).resolves.toMatchObject({ presignedUrl: expect.any(String) });
      await expect(presign(hash(2))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(presign(hash(1), 2048)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(
        await prisma.pendingUpload.findFirstOrThrow({ where: { userId: member, fileName } }),
      ).toMatchObject({ contentHash: hash(1), fileSize: 1024 });

      const group = await caller(admin).groupSettings.requestGroupImageUpload({ groupId });
      const presignGroup = (contentHash: string) =>
        caller(admin).groupSettings.presignGroupImageUpload({
          groupId,
          fileName: group.fileName,
          fileSize: 1024,
          contentHash,
        });
      await Promise.allSettled([presignGroup(hash(3)), presignGroup(hash(4))]);
      const pinned = await prisma.pendingUpload.findFirstOrThrow({
        where: { userId: admin, fileName: group.fileName },
      });
      const other = pinned.contentHash === hash(3) ? hash(4) : hash(3);
      await expect(presignGroup(other)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(presignGroup(pinned.contentHash ?? "")).resolves.toMatchObject({
        presignedUrl: expect.any(String),
      });
    });

    test("a fresh upload request can be presigned for a different picture", async () => {
      await caller(member).account.requestProfileImageUpload();
      const first = await prisma.pendingUpload.findFirstOrThrow({ where: { userId: member } });
      await caller(member).account.presignProfileImageUpload({
        fileName: first.fileName,
        fileSize: 1024,
        contentHash: Buffer.alloc(32, 1).toString("base64"),
      });

      const { fileName } = await caller(member).account.requestProfileImageUpload();
      await expect(
        caller(member).account.presignProfileImageUpload({
          fileName,
          fileSize: 2048,
          contentHash: Buffer.alloc(32, 2).toString("base64"),
        }),
      ).resolves.toMatchObject({ presignedUrl: expect.any(String) });
    });

    test("confirming a group picture stores its key in the same write", async () => {
      const fileName = await addPendingUpload(admin, "groupAvatar", groupId);
      const key = wrap({
        fileName,
        kind: "group-image-key",
        ownerId: groupId,
        senderUserId: admin,
      });

      const result = await caller(admin).groupSettings.confirmGroupImageUpload({ groupId, key });

      expect(result.imageUrl).toBe(groupUrl(admin, groupId, fileName));
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        image: result.imageUrl,
        ...imageKeyColumns(key),
      });
    });

    test("a group picture confirm with an expected file name only replaces that picture", async () => {
      const current = await setGroupPicture();
      const fileName = await addPendingUpload(admin, "groupAvatar", groupId);
      const key = wrap({
        fileName,
        kind: "group-image-key",
        ownerId: groupId,
        senderUserId: admin,
      });
      const confirm = (expectedFileName: string | null) =>
        caller(admin).groupSettings.confirmGroupImageUpload({ expectedFileName, groupId, key });
      const events = () =>
        prisma.groupEvent.count({ where: { groupId, type: "GROUP_IMAGE_CHANGED" } });
      const eventsBefore = await events();

      for (const expectedFileName of [crypto.randomUUID(), null]) {
        await expect(confirm(expectedFileName)).rejects.toMatchObject({
          code: "CONFLICT",
          cause: { reason: "IMAGE_CHANGED" },
        });
      }
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        image: groupUrl(admin, groupId, current.fileName),
        ...imageKeyColumns(current.key),
      });
      expect(await prisma.pendingUpload.count({ where: { userId: admin, fileName } })).toBe(1);
      expect(await events()).toBe(eventsBefore);

      await expect(confirm(current.fileName)).resolves.toMatchObject({
        imageUrl: groupUrl(admin, groupId, fileName),
      });
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        image: groupUrl(admin, groupId, fileName),
        ...imageKeyColumns(key),
      });
    });

    test("a group picture confirm expecting no picture succeeds when there is none", async () => {
      const fileName = await addPendingUpload(admin, "groupAvatar", groupId);
      const key = wrap({
        fileName,
        kind: "group-image-key",
        ownerId: groupId,
        senderUserId: admin,
      });

      await expect(
        caller(admin).groupSettings.confirmGroupImageUpload({
          expectedFileName: null,
          groupId,
          key,
        }),
      ).resolves.toMatchObject({ imageUrl: groupUrl(admin, groupId, fileName) });
    });

    test("a member who isn't an admin can't confirm a group picture", async () => {
      const current = await setGroupPicture();
      const fileName = await addPendingUpload(member, "groupAvatar", groupId);

      await expect(
        caller(member).groupSettings.confirmGroupImageUpload({
          groupId,
          key: wrap({ fileName, kind: "group-image-key", ownerId: groupId, senderUserId: member }),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        image: groupUrl(admin, groupId, current.fileName),
        ...imageKeyColumns(current.key),
      });
      expect(await prisma.pendingUpload.count({ where: { userId: member, fileName } })).toBe(1);
    });

    test("a group picture key must use the latest epoch", async () => {
      const current = await setGroupPicture();
      const fileName = await addPendingUpload(admin, "groupAvatar", groupId);
      const confirm = (epochId: string, senderUserId = admin) =>
        caller(admin).groupSettings.confirmGroupImageUpload({
          groupId,
          key: wrap({
            epochId,
            fileName,
            kind: "group-image-key",
            ownerId: groupId,
            senderUserId,
          }),
        });

      await expect(confirm(oldEpochId)).rejects.toMatchObject({
        cause: { reason: "EPOCH_NOT_LATEST" },
      });
      await expect(confirm(otherEpochId)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Epoch does not belong to this group.",
      });
      await expect(confirm(latestEpochId, owner)).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { reason: "DEVICE_NOT_REGISTERED" },
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      await expect(confirm(latestEpochId)).rejects.toMatchObject({
        cause: { reason: "EPOCH_ROTATION_PENDING" },
      });

      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        image: groupUrl(admin, groupId, current.fileName),
        ...imageKeyColumns(current.key),
      });
      expect(await prisma.pendingUpload.count({ where: { userId: admin, fileName } })).toBe(1);

      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });
      await expect(confirm(latestEpochId)).resolves.toMatchObject({
        imageUrl: groupUrl(admin, groupId, fileName),
      });
    });

    test("confirming a profile picture stores one key per group and clears the rest", async () => {
      await setProfilePicture(member, { targetGroupId: secondGroupId, epochId: secondEpochId });
      const fileName = await addPendingUpload(member, "userAvatar");
      const familyKey = wrap({
        epochId: oldEpochId,
        fileName,
        kind: "profile-image-key",
        ownerId: member,
        senderUserId: member,
      });
      const strangerKey = wrap({
        epochId: otherEpochId,
        fileName,
        kind: "profile-image-key",
        ownerId: member,
        senderUserId: member,
        targetGroupId: otherGroupId,
      });

      const result = await caller(member).account.confirmProfileImageUpload({
        wraps: [
          { groupId, ...familyKey },
          { groupId: otherGroupId, ...strangerKey },
        ],
        sealed: "sealed-copy",
      });

      expect(result.imageUrl).toBe(profileUrl(member, fileName));
      expect(await prisma.user.findUniqueOrThrow({ where: { id: member } })).toMatchObject({
        image: result.imageUrl,
        imageKeySealed: "sealed-copy",
      });
      expect(await memberRow(member)).toMatchObject(imageKeyColumns(familyKey));
      expect(await memberRow(member, secondGroupId)).toMatchObject(imageKeyColumns(null));
      expect(
        await prisma.groupMember.count({
          where: { groupId: otherGroupId, imageKeyCiphertext: { not: null } },
        }),
      ).toBe(0);
    });

    test("a profile picture is stored even while a group's keys need to change", async () => {
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      const fileName = await addPendingUpload(member, "userAvatar");
      const key = wrap({
        fileName,
        kind: "profile-image-key",
        ownerId: member,
        senderUserId: member,
      });

      await caller(member).account.confirmProfileImageUpload({ wraps: [{ groupId, ...key }] });

      expect((await prisma.user.findUniqueOrThrow({ where: { id: member } })).image).toBe(
        profileUrl(member, fileName),
      );
      expect(await memberRow(member)).toMatchObject(imageKeyColumns(key));
    });

    test("a profile picture key under another group's epoch is refused and nothing changes", async () => {
      const current = await setProfilePicture(member);
      const fileName = await addPendingUpload(member, "userAvatar");
      const confirm = (key: ReturnType<typeof wrap>, sealed?: string) =>
        caller(member).account.confirmProfileImageUpload({
          wraps: [{ groupId, ...key }],
          ...(sealed ? { sealed } : {}),
        });

      await expect(
        confirm(
          wrap({
            epochId: secondEpochId,
            fileName,
            kind: "profile-image-key",
            ownerId: member,
            senderUserId: member,
          }),
        ),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Epoch does not belong to this group.",
      });
      await expect(
        confirm(
          wrap({ fileName, kind: "profile-image-key", ownerId: member, senderUserId: owner }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN", cause: { reason: "DEVICE_NOT_REGISTERED" } });

      expect((await prisma.user.findUniqueOrThrow({ where: { id: member } })).image).toBe(
        profileUrl(member, current.fileName),
      );
      expect(await memberRow(member)).toMatchObject(imageKeyColumns(current.key));
      expect(await prisma.pendingUpload.count({ where: { userId: member, fileName } })).toBe(1);
    });

    test("the group list returns the group's key and each member's key", async () => {
      const group = await setGroupPicture();
      const profile = await setProfilePicture(admin);

      const listed = await caller(member).groupMembership.list();
      const family = listed.find(({ id }) => id === groupId);

      expect(family?.imageKey).toEqual(group.key);
      expect(family?.members.find(({ userId }) => userId === admin)).toMatchObject({
        image: profileUrl(admin, profile.fileName),
        imageKey: profile.key,
      });
      expect(family?.members.find(({ userId }) => userId === owner)?.imageKey).toBeNull();
    });

    test("store writes only your own key, for your current picture, under the latest epoch", async () => {
      const group = await setGroupPicture();
      const admins = await setProfilePicture(admin);
      const fileName = crypto.randomUUID();
      await prisma.user.update({
        where: { id: member },
        data: { image: profileUrl(member, fileName) },
      });
      const store = (
        userId: string,
        options: { epochId?: string; fileName?: string; targetGroupId?: string } = {},
      ) =>
        caller(userId).groupImageKeys.store({
          groupId: options.targetGroupId ?? groupId,
          fileName: options.fileName ?? fileName,
          key: wrap({
            epochId: options.epochId ?? latestEpochId,
            fileName: options.fileName ?? fileName,
            kind: "profile-image-key",
            ownerId: userId,
            senderUserId: userId,
            targetGroupId: options.targetGroupId ?? groupId,
          }),
        });

      await expect(store(outsider)).rejects.toMatchObject({
        cause: { reason: "NOT_GROUP_MEMBER" },
      });
      await expect(
        store(member, { targetGroupId: otherGroupId, epochId: otherEpochId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        await prisma.groupMember.count({
          where: { groupId: otherGroupId, imageKeyCiphertext: { not: null } },
        }),
      ).toBe(0);
      await expect(store(member, { fileName: crypto.randomUUID() })).rejects.toMatchObject({
        cause: { reason: "IMAGE_CHANGED" },
      });
      await expect(store(member, { epochId: oldEpochId })).rejects.toMatchObject({
        cause: { reason: "EPOCH_NOT_LATEST" },
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      await expect(store(member)).rejects.toMatchObject({
        cause: { reason: "EPOCH_ROTATION_PENDING" },
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });
      expect(await memberRow(member)).toMatchObject(imageKeyColumns(null));

      const stored = await store(member);

      expect(await memberRow(member)).toMatchObject({
        imageKeyCiphertext: stored.imageKey?.ciphertext,
        imageKeyEpochId: latestEpochId,
        imageKeySenderDeviceId: deviceOf(member),
      });
      expect(await memberRow(admin)).toMatchObject(imageKeyColumns(admins.key));
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject(
        imageKeyColumns(group.key),
      );
      expect(await memberRow(member, secondGroupId)).toMatchObject(imageKeyColumns(null));
    });

    test("any member re-encrypts stale keys, compare-and-swap on the ciphertext and file name", async () => {
      const group = await setGroupPicture({ epochId: oldEpochId });
      const admins = await setProfilePicture(admin, { epochId: oldEpochId });
      const owners = await setProfilePicture(owner, { epochId: oldEpochId });
      const groupKey = wrap({
        fileName: group.fileName,
        kind: "group-image-key",
        ownerId: groupId,
        senderUserId: member,
      });
      const adminKey = wrap({
        fileName: admins.fileName,
        kind: "profile-image-key",
        ownerId: admin,
        senderUserId: member,
      });
      const ownerKey = wrap({
        fileName: owners.fileName,
        kind: "profile-image-key",
        ownerId: owner,
        senderUserId: member,
      });
      const adminMemberId = (await memberRow(admin)).id;
      const ownerMemberId = (await memberRow(owner)).id;
      const uploaderMemberId = (await memberRow(uploader)).id;
      const secondGroupMemberId = (await memberRow(member, secondGroupId)).id;

      const result = await caller(member).groupImageKeys.reEncrypt({
        groupId,
        keys: [
          {
            target: { kind: "group" },
            fileName: group.fileName,
            expectedCiphertext: group.key.ciphertext,
            key: groupKey,
          },
          {
            target: { kind: "member", memberId: adminMemberId },
            fileName: admins.fileName,
            expectedCiphertext: "A".repeat(64),
            key: adminKey,
          },
          {
            target: { kind: "member", memberId: ownerMemberId },
            fileName: crypto.randomUUID(),
            expectedCiphertext: owners.key.ciphertext,
            key: ownerKey,
          },
          {
            target: { kind: "member", memberId: uploaderMemberId },
            fileName: crypto.randomUUID(),
            expectedCiphertext: "B".repeat(64),
            key: ownerKey,
          },
          {
            target: { kind: "member", memberId: secondGroupMemberId },
            fileName: crypto.randomUUID(),
            expectedCiphertext: "C".repeat(64),
            key: ownerKey,
          },
        ],
      });

      expect(result).toEqual({
        reEncrypted: [{ kind: "group" }],
        skipped: [],
        changed: [
          { kind: "member", memberId: adminMemberId },
          { kind: "member", memberId: ownerMemberId },
        ],
        gone: [
          { kind: "member", memberId: uploaderMemberId },
          { kind: "member", memberId: secondGroupMemberId },
        ],
      });
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject(
        imageKeyColumns(groupKey),
      );
      expect(await memberRow(admin)).toMatchObject(imageKeyColumns(admins.key));
      expect(await memberRow(owner)).toMatchObject(imageKeyColumns(owners.key));

      const adminKeyFromOwner = wrap({
        fileName: admins.fileName,
        kind: "profile-image-key",
        ownerId: admin,
        senderUserId: owner,
      });
      const again = await caller(owner).groupImageKeys.reEncrypt({
        groupId,
        keys: [
          {
            target: { kind: "group" },
            fileName: group.fileName,
            expectedCiphertext: groupKey.ciphertext,
            key: wrap({
              fileName: group.fileName,
              kind: "group-image-key",
              ownerId: groupId,
              senderUserId: owner,
            }),
          },
          {
            target: { kind: "member", memberId: adminMemberId },
            fileName: admins.fileName,
            expectedCiphertext: admins.key.ciphertext,
            key: adminKeyFromOwner,
          },
        ],
      });
      expect(again).toMatchObject({
        reEncrypted: [{ kind: "member", memberId: adminMemberId }],
        skipped: [{ kind: "group" }],
      });
      expect(await memberRow(admin)).toMatchObject(imageKeyColumns(adminKeyFromOwner));
      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject(
        imageKeyColumns(groupKey),
      );
    });

    test("re-encrypting refuses outsiders, old epochs, pending rotations and other devices", async () => {
      const group = await setGroupPicture({ epochId: oldEpochId });
      const reEncrypt = (userId: string, { epochId = latestEpochId, senderUserId = userId } = {}) =>
        caller(userId).groupImageKeys.reEncrypt({
          groupId,
          keys: [
            {
              target: { kind: "group" },
              fileName: group.fileName,
              expectedCiphertext: group.key.ciphertext,
              key: wrap({
                epochId,
                fileName: group.fileName,
                kind: "group-image-key",
                ownerId: groupId,
                senderUserId,
              }),
            },
          ],
        });

      await expect(reEncrypt(outsider)).rejects.toMatchObject({
        cause: { reason: "NOT_GROUP_MEMBER" },
      });
      await expect(reEncrypt(member, { epochId: oldEpochId })).rejects.toMatchObject({
        cause: { reason: "EPOCH_NOT_LATEST" },
      });
      await expect(reEncrypt(member, { epochId: otherEpochId })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Epoch does not belong to this group.",
      });
      await expect(reEncrypt(member, { senderUserId: admin })).rejects.toMatchObject({
        cause: { reason: "DEVICE_NOT_REGISTERED" },
      });
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      await expect(reEncrypt(member)).rejects.toMatchObject({
        cause: { reason: "EPOCH_ROTATION_PENDING" },
      });

      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject(
        imageKeyColumns(group.key),
      );
    });

    test("the catch-up flag lists stale keys for everyone and a missing key only for its owner", async () => {
      const needCatchUp = (userId: string) => readImageKeysNeedCatchUp({ db: prisma, userId });
      expect(await needCatchUp(member)).toEqual([]);

      await setGroupPicture();
      await setProfilePicture(admin);
      await setProfilePicture(member, { targetGroupId: secondGroupId, epochId: secondEpochId });
      expect(await needCatchUp(member)).toEqual([groupId]);
      expect(await needCatchUp(admin)).toEqual([]);

      await setProfilePicture(member);
      expect(await needCatchUp(member)).toEqual([]);

      await setGroupPicture({ epochId: oldEpochId });
      expect(await needCatchUp(member)).toEqual([groupId]);
      expect(await needCatchUp(admin)).toEqual([groupId]);

      await setGroupPicture();
      await setProfilePicture(owner, { epochId: oldEpochId });
      expect(await needCatchUp(member)).toEqual([groupId]);
      expect(await needCatchUp(owner)).toEqual([groupId, secondGroupId]);
      expect(await needCatchUp(outsider)).toEqual([]);

      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: true } });
      expect(await needCatchUp(member)).toEqual([]);
      expect(await needCatchUp(owner)).toEqual([secondGroupId]);
      await prisma.group.update({ where: { id: groupId }, data: { epochRotationRequired: false } });

      await setProfilePicture(owner);
      expect(await needCatchUp(member)).toEqual([]);
      expect(await needCatchUp(owner)).toEqual([secondGroupId]);
    });

    test("deleting the uploader's account clears the group picture and its key", async () => {
      await prisma.user.create({
        data: { id: deletedUploader, name: "Uploader", email: `${deletedUploader}@example.test` },
      });
      await prisma.groupMember.create({
        data: { userId: deletedUploader, groupId, role: "ADMIN", joinedEpochNumber: 1 },
      });
      const fileName = crypto.randomUUID();
      const key = wrap({
        fileName,
        kind: "group-image-key",
        ownerId: groupId,
        senderUserId: deletedUploader,
      });
      await prisma.group.update({
        where: { id: groupId },
        data: { image: groupUrl(deletedUploader, groupId, fileName), ...imageKeyColumns(key) },
      });

      await deleteAccountRecords({
        db: prisma,
        userId: deletedUploader,
        imageUrlPrefix: `${env.IMAGES_S3_CDN_URL}/${env.IMAGES_S3_BUCKET_NAME}`,
        mode: "immediate",
        securityAlerts: null,
      });

      expect(await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).toMatchObject({
        image: null,
        ...imageKeyColumns(null),
      });
      expect(await prisma.user.count({ where: { id: deletedUploader } })).toBe(0);
      expect(await prisma.groupMember.count({ where: { groupId } })).toBe(4);
    });

    test("the migration clears every picture and key", async () => {
      await setGroupPicture();
      await setProfilePicture(member);
      await prisma.user.update({ where: { id: member }, data: { imageKeySealed: "sealed" } });
      const migration = await readFile(
        new URL(
          "../../../../database/prisma/migrations/20261116185351_encrypt_images/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const updates = migration
        .split(";")
        .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
        .filter((statement) => statement.startsWith("UPDATE"));
      expect(updates).toHaveLength(3);

      const rolledBack = new Error("roll back");
      const { error } = await tryCatch(
        prisma.$transaction(async (tx) => {
          for (const statement of updates) await tx.$executeRawUnsafe(statement);
          expect(
            await tx.user.count({
              where: { OR: [{ image: { not: null } }, { imageKeySealed: { not: null } }] },
            }),
          ).toBe(0);
          expect(
            await tx.group.count({
              where: {
                OR: [{ image: { not: null } }, { imageKeyCiphertext: { not: null } }],
              },
            }),
          ).toBe(0);
          expect(await tx.groupMember.count({ where: { imageKeyCiphertext: { not: null } } })).toBe(
            0,
          );
          throw rolledBack;
        }),
      );
      expect(error).toBe(rolledBack);
    });
  },
);
