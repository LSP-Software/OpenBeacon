import { createHash } from "node:crypto";
import type { PrismaClient } from "@openbeacon/database";
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
export const buildGroupAvatarPath = (groupId: string): string => `group/${groupId}/uploads/avatar`;

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
    const lockKey = Math.abs(createHash("sha256").update(userId, "utf8").digest().readInt32BE(0));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const existing = await tx.pendingUpload.findUnique({
      where: { userId_uploadType: { userId, uploadType } },
      select: { fileName: true, groupId: true },
    });

    if (existing) {
      oldFileName = existing.fileName;
      oldGroupId = existing.groupId ?? null;
      await tx.pendingUpload.delete({
        where: { userId_uploadType: { userId, uploadType } },
      });
    }

    await tx.pendingUpload.create({
      data: { userId, uploadType, fileName, groupId: groupId ?? null },
    });
  });

  if (oldFileName) {
    const oldImagePath = oldGroupId ? buildGroupAvatarPath(oldGroupId) : currentImagePath;
    await tryCatch(deleteFile(bucketName, oldImagePath, oldFileName));
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
      message: `Failed to generate presigned URL: ${presignError.message}`,
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
  commitImageUpload: (imageUrl: string) => Promise<void>;
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
      message: `Upload verification failed: ${verifyError.message ?? "Unknown error."}`,
    });
  }

  if (!fileSize || fileSize > env.MAX_IMAGE_FILE_SIZE) {
    await deleteFile(bucketName, imagePath, pendingFileName);
    await db.pendingUpload.delete({
      where: { userId_uploadType: { userId, uploadType } },
    });

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Uploaded failed verification.",
    });
  }

  const imageUrl = buildImagePublicUrl(bucketName, imagePath, pendingFileName);

  await commitImageUpload(imageUrl);

  if (currentImageUrl) {
    const currentImageStorageObject = extractImageStorageObject(currentImageUrl);
    if (currentImageStorageObject) {
      await tryCatch(
        deleteFile(
          currentImageStorageObject.bucketName,
          currentImageStorageObject.path,
          currentImageStorageObject.fileName,
        ),
      );
    }
  }

  return { imageUrl };
};
