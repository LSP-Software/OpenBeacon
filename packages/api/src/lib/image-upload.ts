import { ImageContentType, ImageFileExtension } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
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

export const requestImageUploadInputSchema = z.object({
  fileSize: z.number().int().nonnegative().max(env.MAX_IMAGE_FILE_SIZE),
  contentHash: z.string(),
});

type RequestImageUploadOptions = {
  bucketName: string;
  contentHash: string;
  imagePath: string;
  replacePendingImageUpload: (fileName: string) => Promise<string | null>;
};

type PendingImageUpload = {
  fileName: string;
};

type ConfirmImageUploadOptions = {
  bucketName: string;
  imagePath: string;
  getPendingImageUpload: () => Promise<PendingImageUpload | null>;
  clearPendingImageUpload: () => Promise<void>;
  getCurrentImageUrl: () => Promise<string | null>;
  setCurrentImageUrl: (imageUrl: string) => Promise<void>;
  noPendingImageUploadMessage: string;
};

export const createImageOwnerLockKey = (imageOwnerId: string): number => {
  let hash = 0;
  for (let index = 0; index < imageOwnerId.length; index++) {
    hash = ((hash << 5) - hash + imageOwnerId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

export const requestImageUpload = async ({
  bucketName,
  contentHash,
  imagePath,
  replacePendingImageUpload,
}: RequestImageUploadOptions): Promise<{ presignedUrl: string }> => {
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
}: ConfirmImageUploadOptions): Promise<{ imageUrl: string }> => {
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
