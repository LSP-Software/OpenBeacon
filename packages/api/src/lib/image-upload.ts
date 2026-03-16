import type { PrismaClient } from "@openbeacon/database";
import { ImageContentType, ImageFileExtension } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { env } from "../env.ts";
import {
  buildImagePublicUrl,
  deleteFile,
  extractImageStorageObject,
  getFileSize,
  getPresignedUploadUrl,
} from "./storage.ts";
import { tryCatch } from "./tryCatch.ts";

export type ImageUploadType = "userAvatar" | "groupAvatar";

export const buildUserAvatarPath = (userId: string): string => `user/${userId}/uploads/avatar`;

export const buildGroupAvatarPath = (groupId: string): string => `group/${groupId}/uploads/avatar`;

type PendingUploadDb = Pick<PrismaClient, "$transaction" | "pendingUpload">;

type GroupDB = Pick<PrismaClient, "$transaction" | "group">;

export const replacePendingImageUploadForUser = async ({
  db,
  userId,
  uploadType,
  fileName,
  groupId,
}: {
  db: PendingUploadDb;
  userId: string;
  uploadType: ImageUploadType;
  fileName: string;
  groupId?: string;
}): Promise<string | null> => {
  let oldFileName: string | null = null;

  await db.$transaction(async (tx) => {
    const lockKey = Math.abs(
      createHash("sha256").update(userId, "utf8").digest().readInt32BE(0),
    );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const existing = await tx.pendingUpload.findUnique({
      where: { userId_uploadType: { userId, uploadType } },
      select: { fileName: true },
    });

    if (existing) {
      oldFileName = existing.fileName;
      await tx.pendingUpload.delete({
        where: { userId_uploadType: { userId, uploadType } },
      });
    }

    await tx.pendingUpload.create({
      data: { userId, uploadType, fileName, ...(groupId != null && { groupId }) },
    });
  });

  return oldFileName;
};

export const getPendingImageUploadForUser = async ({
  db,
  userId,
  uploadType,
}: {
  db: PendingUploadDb;
  userId: string;
  uploadType: ImageUploadType;
}): Promise<{ fileName: string } | null> =>
  db.pendingUpload.findUnique({
    where: { userId_uploadType: { userId, uploadType } },
    select: { fileName: true },
  });

export const clearPendingImageUploadForUser = async ({
  db,
  userId,
  uploadType,
}: {
  db: PendingUploadDb;
  userId: string;
  uploadType: ImageUploadType;
}): Promise<void> => {
  await db.pendingUpload.delete({
    where: { userId_uploadType: { userId, uploadType } },
  });
};

export const getPendingImageUploadForGroup = async ({
  db,
  groupId,
  uploadType,
}: {
  db: PendingUploadDb;
  groupId: string;
  uploadType: ImageUploadType;
}): Promise<{ fileName: string } | null> =>
  db.pendingUpload.findFirst({
    where: { uploadType, groupId },
    select: { fileName: true },
  });

export const clearPendingImageUploadForGroup = async ({
  db,
  groupId,
  uploadType,
}: {
  db: PendingUploadDb;
  groupId: string;
  uploadType: ImageUploadType;
}): Promise<void> => {
  await db.pendingUpload.deleteMany({
    where: { uploadType, groupId },
  });
};

export const getGroupForGroupImageOrThrow = async ({
  db,
  groupId,
}: {
  db: GroupDB;
  groupId: string;
}) => {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { id: true, image: true },
  });

  if (!group) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Group not found.",
    });
  }

  return group;
};


export const requestImageUploadInputSchema = z.object({
  fileSize: z.number().int().nonnegative().max(env.MAX_IMAGE_FILE_SIZE),
  contentHash: z.string(),
});

export const requestImageUpload = async ({
  bucketName,
  contentHash,
  imagePath,
  replacePendingImageUpload,
}: {
  bucketName: string;
  contentHash: string;
  imagePath: string;
  replacePendingImageUpload: (fileName: string) => Promise<string | null>;
}): Promise<{ presignedUrl: string }> => {
  const fileName = `${crypto.randomUUID()}.${ImageFileExtension}`;

  const { data: presignedUrl, error: presignError } = await tryCatch(
    getPresignedUploadUrl(bucketName, imagePath, fileName, ImageContentType, contentHash),
  );

  if (presignError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to generate presigned URL: ${presignError.message}`,
    });
  }

  const oldFileName = await replacePendingImageUpload(fileName);
  if (oldFileName) {
    await tryCatch(deleteFile(bucketName, imagePath, oldFileName));
  }

  return { presignedUrl };
};

const clearInvalidPendingImageUpload = async ({
  bucketName,
  imagePath,
  fileName,
  clearPendingImageUpload,
}: {
  bucketName: string;
  imagePath: string;
  fileName: string;
  clearPendingImageUpload: () => Promise<void>;
}): Promise<void> => {
  await tryCatch(deleteFile(bucketName, imagePath, fileName));
  await tryCatch(clearPendingImageUpload());
};

export const confirmImageUpload = async ({
  bucketName,
  imagePath,
  getPendingImageUpload,
  clearPendingImageUpload,
  getCurrentImageUrl,
  setCurrentImageUrl,
  noPendingImageUploadMessage,
}: {
  bucketName: string;
  imagePath: string;
  getPendingImageUpload: () => Promise<{ fileName: string; } | null>;
  clearPendingImageUpload: () => Promise<void>;
  getCurrentImageUrl: () => Promise<string | null>;
  setCurrentImageUrl: (imageUrl: string) => Promise<void>;
  noPendingImageUploadMessage: string;
}): Promise<{ imageUrl: string }> => {
  const pendingImageUpload = await getPendingImageUpload();
  if (!pendingImageUpload) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: noPendingImageUploadMessage,
    });
  }

  const { data: fileSize, error: verifyError } = await tryCatch(
    getFileSize(bucketName, imagePath, pendingImageUpload.fileName),
  );

  if (verifyError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Upload verification failed: ${verifyError.message ?? "Unknown error."}`,
    });
  }

  if (!fileSize) {
    await clearInvalidPendingImageUpload({
      bucketName,
      imagePath,
      fileName: pendingImageUpload.fileName,
      clearPendingImageUpload,
    });
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Uploaded file not found or is empty in storage.",
    });
  }

  if (fileSize > env.MAX_IMAGE_FILE_SIZE) {
    await clearInvalidPendingImageUpload({
      bucketName,
      imagePath,
      fileName: pendingImageUpload.fileName,
      clearPendingImageUpload,
    });
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Uploaded file exceeds the maximum allowed size.",
    });
  }

  const imageUrl = buildImagePublicUrl(bucketName, imagePath, pendingImageUpload.fileName);
  const currentImageUrl = await getCurrentImageUrl();

  await setCurrentImageUrl(imageUrl);
  await tryCatch(clearPendingImageUpload());

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
