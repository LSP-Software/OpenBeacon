import { encryptImage, type ImageKeyMaterial, type ImagePurpose } from "@openbeacon/encryption";
import {
  devicePendingCause,
  deviceRemovedCause,
  deviceUnverifiedCause,
  tryCatch,
} from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";
import { errorReason } from "./errorReason.ts";
import { imageCacheGeneration, writeCachedImage } from "./imageCache.ts";
import { GroupKeyUnavailableError, ImageStorageError } from "./imageUploadErrors.ts";

export const computeSha256Base64 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const hashBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const hashBytes = new Uint8Array(hashBuffer);
  let binary = "";
  for (const byte of hashBytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export const uploadToPresignedUrl = async (
  presignedUrl: string,
  bytes: ArrayBuffer,
  contentHash: string,
  timeoutMs = 60_000,
): Promise<void> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await tryCatch(
    fetch(presignedUrl, {
      method: "PUT",
      body: bytes,
      headers: {
        "Content-Type": "application/octet-stream",
        "x-amz-checksum-sha256": contentHash,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer)),
  );
  if (response.error) throw new ImageStorageError(null);
  if (!response.data.ok) throw new ImageStorageError(response.data.status);
};

export const uploadEncryptedImage = async ({
  bytes,
  confirm,
  ownerId,
  presign,
  purpose,
  request,
}: {
  bytes: Uint8Array;
  confirm: (input: { fileName: string; imageKey: ImageKeyMaterial }) => Promise<{
    imageUrl: string;
  }>;
  ownerId: string;
  presign: (input: {
    contentHash: string;
    fileName: string;
    fileSize: number;
  }) => Promise<{ presignedUrl: string }>;
  purpose: ImagePurpose;
  request: () => Promise<{ fileName: string }>;
}) => {
  const forGeneration = imageCacheGeneration();
  const { fileName } = await request();
  const { blob, key } = encryptImage({ bytes, fileName, ownerId, purpose });
  const contentHash = await computeSha256Base64(blob);
  const { presignedUrl } = await presign({ contentHash, fileName, fileSize: blob.byteLength });
  const put = await tryCatch(uploadToPresignedUrl(presignedUrl, blob.buffer, contentHash));
  if (put.error) await uploadToPresignedUrl(presignedUrl, blob.buffer, contentHash);
  const { imageUrl } = await confirm({ fileName, imageKey: key });
  await tryCatch(
    Promise.resolve().then(() => writeCachedImage({ bytes, fileName, forGeneration })),
  );
  return { fileName, imageUrl };
};

export const imageUploadErrorMessage = (error: unknown) => {
  if (error instanceof GroupKeyUnavailableError) {
    return "This phone is still catching up with this group. Try again in a minute.";
  }
  if (error instanceof ImageStorageError || !(error instanceof TRPCClientError) || !error.data) {
    return "Unable to upload the picture. Check your connection and try again.";
  }
  const cause: unknown = error.data.cause;
  if (cause === devicePendingCause || cause === deviceUnverifiedCause) return error.message;
  if (cause === deviceRemovedCause) return "This phone was removed from your account.";
  switch (errorReason(error)) {
    case "DEVICE_NOT_REGISTERED":
      return "This phone is still being set up. Try again in a minute.";
    case "EPOCH_NOT_LATEST":
    case "EPOCH_ROTATION_PENDING":
      return "This group’s keys are being updated. Try again in a minute.";
    case "IMAGE_CHANGED":
      return "Your picture was changed on another phone. Try again.";
    case "NOT_GROUP_MEMBER":
    case "GROUP_GONE":
      return "You’re no longer in this group.";
  }
  if (error.data.code === "PRECONDITION_FAILED") {
    return "That upload expired. Choose the picture again.";
  }
  if (error.data.code === "FORBIDDEN") {
    return "Only group owners and admins can change the group picture.";
  }
  if (error.data.code === "TOO_MANY_REQUESTS") {
    return "Too many uploads. Wait a minute and try again.";
  }
  if (error.data.httpStatus < 500) {
    return "That picture couldn’t be uploaded. Try a different one.";
  }
  return "Unable to upload the picture. Check your connection and try again.";
};

export type ImageUploadResult = { data: string; error?: never } | { data?: never; error: string };

export const uploadImageFromUri = async ({
  uri,
  ...upload
}: Omit<Parameters<typeof uploadEncryptedImage>[0], "bytes"> & {
  uri: string;
}): Promise<ImageUploadResult> => {
  const bytes = await tryCatch(new FSFile(uri).bytes());
  if (bytes.error) {
    cleanupTempFile(uri);
    return { error: "Unable to read that picture. Try a different one." };
  }
  let result = await tryCatch(uploadEncryptedImage({ ...upload, bytes: bytes.data }));
  if (
    result.error instanceof TRPCClientError &&
    result.error.data?.code === "PRECONDITION_FAILED"
  ) {
    result = await tryCatch(uploadEncryptedImage({ ...upload, bytes: bytes.data }));
  }
  cleanupTempFile(uri);
  if (result.error) {
    console.error("Image upload failed", errorReason(result.error) ?? result.error.name);
    return { error: imageUploadErrorMessage(result.error) };
  }
  return { data: result.data.imageUrl };
};

export const cleanupTempFile = (uri: string): void => {
  const file = new FSFile(uri);
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // best-effort cleanup; ignore errors
  }
};
