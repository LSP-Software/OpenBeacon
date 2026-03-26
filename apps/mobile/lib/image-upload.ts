import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";

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
      "Content-Type": "image/webp",
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
  try {
    const rawfileBytes = await file.bytes();
    const bytes = rawfileBytes.slice().buffer;
    const contentHash = await computeSha256Base64(bytes);
    const uploadData = await requestImageUpload({ contentHash, fileSize: bytes.byteLength });
    await uploadToPresignedUrl(uploadData.presignedUrl, bytes, contentHash);
    const confirmData = await confirmImageUpload();
    return { data: confirmData.imageUrl };
  } catch (error) {
    return { error: `Unable to upload image: ${String(error)}` };
  }
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
