import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import ImageCropPicker from "react-native-image-crop-picker";
import { tryCatch } from "./tryCatch.ts";

const DEFAULT_IMAGE_SIZE = 1024;
const IMAGE_QUALITY = 0.85;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export const computeSha256Base64 = async (bytes: ArrayBuffer): Promise<string> => {
  const hashBuffer = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes),
  );
  return arrayBufferToBase64(hashBuffer);
};

export type PickImageResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: Error };

export const pickAndCropImage = async (
  size: number = DEFAULT_IMAGE_SIZE,
): Promise<PickImageResult> => {
  const { data: image, error } = await tryCatch(
    ImageCropPicker.openPicker({
      cropping: true,
      cropperCircleOverlay: true,
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

export const getFileSize = (uri: string): number | undefined => {
  const size = new FSFile(uri).size;
  if (size === undefined) {
    console.error("Could not determine file size: file may not exist");
    return;
  }
  return size;
};

export const readImageBytes = async (uri: string): Promise<ArrayBuffer> => {
  const file = new FSFile(uri);
  const bytes = await file.bytes();
  return bytes.buffer;
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
    const summary = `Failed to upload image to S3 (HTTP ${response.status.toString()})`;
    throw new Error(`${summary}\n${response}`);
  }
};

export const cleanupTempFile = (uri: string): void => {
  const file = new FSFile(uri);
  if (file.exists) {
    file.delete();
  }
};
