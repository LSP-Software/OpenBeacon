import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import ImageCropPicker from "react-native-image-crop-picker";
import { tryCatch } from "./tryCatch.ts";

const IMAGE_SIZE = 1024;
const IMAGE_QUALITY = 0.85;

function ensureFileUri(path: string): string {
  if (path.startsWith("file://")) return path;
  return `file://${path}`;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function pickAndCropImage(): Promise<string | null> {
  const { data: image, error } = await tryCatch(
    ImageCropPicker.openPicker({
      cropping: true,
      cropperCircleOverlay: true,
      width: IMAGE_SIZE,
      height: IMAGE_SIZE,
      mediaType: "photo",
    }),
  );

  if (error) return null;
  return image.path;
}

export async function processImage(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(ensureFileUri(uri));
  const imageRef = await context.resize({ width: IMAGE_SIZE, height: IMAGE_SIZE }).renderAsync();
  const result = await imageRef.saveAsync({ format: SaveFormat.WEBP, compress: IMAGE_QUALITY });
  return result.uri;
}

export function getFileSize(uri: string): number {
  return new FSFile(ensureFileUri(uri)).size;
}

export async function computeSha1(uri: string): Promise<string> {
  const fileBytes = await new FSFile(ensureFileUri(uri)).bytes();
  const hashBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, fileBytes);
  return arrayBufferToHex(hashBuffer);
}

export async function uploadToPresignedUrl(presignedUrl: string, fileUri: string): Promise<void> {
  const file = new FSFile(ensureFileUri(fileUri));
  const response = await fetch(presignedUrl, {
    method: "PUT",
    body: file as unknown as Blob,
    headers: { "Content-Type": "image/webp" },
  });

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status.toString()}`);
  }
}

export function cleanupTempFile(uri: string): void {
  const file = new FSFile(ensureFileUri(uri));
  if (file.exists) {
    file.delete();
  }
}
