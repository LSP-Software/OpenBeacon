import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import ImageCropPicker from "react-native-image-crop-picker";
import { tryCatch } from "./tryCatch.ts";

const DEFAULT_IMAGE_SIZE = 1024;
const IMAGE_QUALITY = 0.85;

function ensureFileUri(path: string): string {
  if (path.startsWith("file://")) return path;
  return `file://${path}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function pickAndCropImage(size: number = DEFAULT_IMAGE_SIZE): Promise<string | null> {
  const { data: image, error } = await tryCatch(
    ImageCropPicker.openPicker({
      cropping: true,
      cropperCircleOverlay: true,
      width: size,
      height: size,
      mediaType: "photo",
    }),
  );

  if (error) return null;
  return image.path;
}

export async function processImage(
  uri: string,
  size: number = DEFAULT_IMAGE_SIZE,
): Promise<string> {
  const context = ImageManipulator.manipulate(ensureFileUri(uri));
  const imageRef = await context.resize({ width: size, height: size }).renderAsync();
  const result = await imageRef.saveAsync({ format: SaveFormat.WEBP, compress: IMAGE_QUALITY });
  return result.uri;
}

export function getFileSize(uri: string): number {
  const size = new FSFile(ensureFileUri(uri)).size;
  if (size === undefined) throw new Error("Could not determine file size: file may not exist");
  return size;
}

export async function computeSha256Base64(uri: string): Promise<string> {
  const fileBytes = await new FSFile(ensureFileUri(uri)).bytes();
  const hashBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, fileBytes);
  return arrayBufferToBase64(hashBuffer);
}

async function parseS3ErrorBody(response: Response): Promise<string> {
  const { data: body } = await tryCatch(response.text());
  if (!body) return "";

  const codeMatch = body.match(/<Code>(.+?)<\/Code>/);
  const messageMatch = body.match(/<Message>(.+?)<\/Message>/);
  const parts: string[] = [];
  if (codeMatch?.[1]) parts.push(codeMatch[1]);
  if (messageMatch?.[1]) parts.push(messageMatch[1]);
  return parts.join(": ");
}

export async function uploadToPresignedUrl(
  presignedUrl: string,
  fileUri: string,
  contentHash: string,
): Promise<void> {
  const file = new FSFile(ensureFileUri(fileUri));
  const bytes = await file.bytes();
  const response = await fetch(presignedUrl, {
    method: "PUT",
    body: bytes,
    headers: {
      "Content-Type": "image/webp",
      "x-amz-checksum-sha256": contentHash,
    },
  });

  if (!response.ok) {
    const detail = await parseS3ErrorBody(response);
    const summary = `Failed to upload image to S3 (HTTP ${response.status.toString()})`;
    throw new Error(detail ? `${summary}\n${detail}` : summary);
  }
}

export function cleanupTempFile(uri: string): void {
  const file = new FSFile(ensureFileUri(uri));
  if (file.exists) {
    file.delete();
  }
}
