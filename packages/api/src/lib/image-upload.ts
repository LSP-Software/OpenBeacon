import { createHash } from "node:crypto";
import { GroupRole, Prisma, type PrismaClient } from "@openbeacon/database";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { env } from "../env.ts";
import {
  buildImagePublicUrl,
  deleteFile,
  extractImageStorageObject,
  getFileSize,
  getPresignedUploadUrl,
} from "./storage.ts";

export type ImageUploadType = "userAvatar" | "groupAvatar";

export const buildUserAvatarPath = (userId: string): string => `user/${userId}/uploads/avatar`;
export const buildGroupAvatarPath = (userId: string, groupId: string): string =>
  `user/${userId}/uploads/group/${groupId}/avatar`;

export const setPendingImageUploadForUser = async ({
  db,
  userId,
  uploadType,
  fileName,
  groupId,
  bucketName,
  currentImagePath,
}: {
  db: PrismaClient;
  userId: string;
  uploadType: ImageUploadType;
  fileName: string;
  groupId?: string;
  bucketName: string;
  currentImagePath: string;
}): Promise<void> => {
  let oldFileName: string | null = null;
  let oldGroupId: string | null = null;

  await db.$transaction(async (tx) => {
    if (groupId) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Group" WHERE id = ${groupId} FOR UPDATE`);
      const member = await tx.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      });
      if (member?.role !== GroupRole.OWNER && member?.role !== GroupRole.ADMIN) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not an admin of this group" });
      }
    }
    const lockKey = Math.abs(createHash("sha256").update(userId, "utf8").digest().readInt32BE(0));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const existing = await tx.pendingUpload.findUnique({
      where: { userId_uploadType_groupId: { userId, uploadType, groupId: groupId ?? "" } },
      select: { fileName: true, groupId: true },
    });

    if (existing) {
      const deleted = await tx.pendingUpload.deleteMany({
        where: { userId, uploadType, groupId: groupId ?? "", fileName: existing.fileName },
      });
      if (deleted.count === 1) {
        oldFileName = existing.fileName;
        oldGroupId = existing.groupId ?? null;
      }
    }

    await tx.pendingUpload.create({
      data: { userId, uploadType, fileName, groupId: groupId ?? "" },
    });
  });

  if (oldFileName) {
    const oldImagePath = oldGroupId ? buildGroupAvatarPath(userId, oldGroupId) : currentImagePath;
    const { error } = await tryCatch(deleteFile(bucketName, oldImagePath, oldFileName));
    if (error) console.error("[image-upload] failed to delete previous pending image");
  }
};

export const requestImageUpload = async ({
  bucketName,
  contentHash,
  fileSize,
  imagePath,
  fileName,
}: {
  bucketName: string;
  contentHash: string;
  fileSize: number;
  imagePath: string;
  fileName: string;
}): Promise<{ presignedUrl: string }> => {
  const { data: presignedUrl, error: presignError } = await tryCatch(
    getPresignedUploadUrl(bucketName, imagePath, fileName, "image/webp", contentHash, fileSize),
  );

  if (presignError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to generate presigned URL.",
      cause: presignError,
    });
  }

  return { presignedUrl };
};

export const confirmImageUpload = async ({
  db,
  userId,
  uploadType,
  bucketName,
  imagePath,
  pendingFileName,
  currentImageUrl,
  noPendingImageUploadMessage,
  commitImageUpload,
}: {
  db: PrismaClient;
  userId: string;
  uploadType: ImageUploadType;
  bucketName: string;
  imagePath: string;
  pendingFileName: string | null;
  commitImageUpload: (imageUrl: string) => Promise<string | null | undefined>;
  currentImageUrl: string | null;
  noPendingImageUploadMessage: string;
}): Promise<{ imageUrl: string }> => {
  if (!pendingFileName) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: noPendingImageUploadMessage,
    });
  }

  const { data: fileSize, error: verifyError } = await tryCatch(
    getFileSize(bucketName, imagePath, pendingFileName),
  );

  if (verifyError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Upload verification failed.",
      cause: verifyError,
    });
  }

  if (!fileSize || fileSize > env.MAX_IMAGE_FILE_SIZE) {
    await deleteFile(bucketName, imagePath, pendingFileName);
    await db.pendingUpload.deleteMany({
      where: { userId, uploadType, fileName: pendingFileName },
    });

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Uploaded failed verification.",
    });
  }

  const imageUrl = buildImagePublicUrl(bucketName, imagePath, pendingFileName);

  const replacedImageUrl = await commitImageUpload(imageUrl);
  const imageToDelete = replacedImageUrl === undefined ? currentImageUrl : replacedImageUrl;

  if (imageToDelete && imageToDelete !== imageUrl) {
    const currentImageStorageObject = extractImageStorageObject(imageToDelete);
    if (currentImageStorageObject) {
      const { error } = await tryCatch(
        deleteFile(
          currentImageStorageObject.bucketName,
          currentImageStorageObject.path,
          currentImageStorageObject.fileName,
        ),
      );
      if (error) console.error("[image-upload] failed to delete replaced image");
    }
  }

  return { imageUrl };
};
