import type { ImageCropShape } from "@openbeacon/shared";
import { ImageContentType } from "@openbeacon/shared";
import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import ImageCropPicker from "react-native-image-crop-picker";
import { tryCatch } from "./tryCatch.ts";

const DEFAULT_IMAGE_SIZE = 1024;
const IMAGE_QUALITY = 0.85;

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

export type PickImageResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: Error };

export const pickAndCropImage = async (
  size: number = DEFAULT_IMAGE_SIZE,
  cropShape: ImageCropShape = "circle",
): Promise<PickImageResult> => {
  const { data: image, error } = await tryCatch(
    ImageCropPicker.openPicker({
      cropping: true,
      cropperCircleOverlay: cropShape === "circle",
      width: size,
      height: size,
      mediaType: "photo",
    }),
  );

  if (!error) {
    return { ok: true, path: image.path };
  }
  if (error.message.includes("User cancelled")) {
    return { ok: false, cancelled: true };
  }
  return { ok: false, error: new Error(String(error)) };
};

export const processImage = async (
  uri: string,
  size: number = DEFAULT_IMAGE_SIZE,
): Promise<string> => {
  const context = ImageManipulator.manipulate(uri);
  const imageRef = await context.resize({ width: size, height: size }).renderAsync();
  const result = await imageRef.saveAsync({ format: SaveFormat.WEBP, compress: IMAGE_QUALITY });
  return result.uri;
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
    const summary = `Failed to upload image to S3 (HTTP ${response.status.toString()})`;
    throw new Error(`${summary}\n${await response.text()}`);
  }
};

type UploadImageFromUriResult<T, E = string> =
  | { data: T; error?: never }
  | { data?: never; error: E };

type UploadImageFromUriOptions = {
  uri: string;
  requestImageUpload: (input: { fileSize: number; contentHash: string; }) => Promise<{ presignedUrl: string; }>;
  confirmImageUpload: () => Promise<{ imageUrl: string }>;
};

export const uploadImageFromUri = async ({
  uri,
  requestImageUpload,
  confirmImageUpload,
}: UploadImageFromUriOptions): Promise<UploadImageFromUriResult<string | null>> => {
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
