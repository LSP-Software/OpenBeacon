
import { ImageContentType } from "@openbeacon/shared";
import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";

import { tryCatch } from "./tryCatch.ts";



export const computeSha256Base64 = async (bytes: ArrayBuffer): Promise<string> => {
  const hashBuffer = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes),
  );
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
): Promise<void> => {
  const response = await fetch(presignedUrl, {
    method: "PUT",
    body: bytes,
    headers: {
      "Content-Type": ImageContentType,
      "x-amz-checksum-sha256": contentHash,
    },
  });

  if (!response.ok) {
    const summary = `${response.status.toString()}`;
    throw new Error(`${summary}\n${await response.text()}`);
  }
};

export const uploadImageFromUri = async ({
  uri,
  requestImageUpload,
  confirmImageUpload,
}: {
  uri: string;
  requestImageUpload: (input: {
    fileSize: number;
    contentHash: string;
  }) => Promise<{ presignedUrl: string }>;
  confirmImageUpload: () => Promise<{ imageUrl: string }>;
}): Promise<{ data: string | null; error?: never } | { data?: never; error: string }> => {
  const file = new FSFile(uri);
  const { data: bytes, error: readError } = await tryCatch(
    (async () => {
      const fileBytes = await file.bytes();
      return fileBytes.slice().buffer;
    })(),
  );
  if (readError) return { error: `Unable to read image bytes: ${readError.message}` };

  const { data: contentHash, error: hashError } = await tryCatch(computeSha256Base64(bytes));
  if (hashError) return { error: `Unable to compute content hash: ${hashError.message}` };

  const { data: uploadData, error: requestError } = await tryCatch(
    requestImageUpload({ contentHash, fileSize: bytes.byteLength }),
  );
  if (requestError) return { error: `Unable to request upload: ${requestError.message}` };

  const { error: uploadError } = await tryCatch(
    uploadToPresignedUrl(uploadData.presignedUrl, bytes, contentHash),
  );
  if (uploadError) return { error: `Unable to upload image: ${uploadError.message}` };

  const { data: confirmData, error: confirmError } = await tryCatch(confirmImageUpload());
  if (confirmError) return { error: `Unable to confirm upload: ${confirmError.message}` };

  return { data: confirmData.imageUrl };
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
