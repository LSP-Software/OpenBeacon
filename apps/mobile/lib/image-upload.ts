import * as Crypto from "expo-crypto";
import { File as FSFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import ImageCropPicker from "react-native-image-crop-picker";
import { tryCatch } from "./tryCatch.ts";

const DEFAULT_IMAGE_SIZE = 1024;
const IMAGE_QUALITY = 0.85;

const ensureFileUri = (path: string): string => {
  if (path.startsWith("file://")) return path;
  return `file://${path}`;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const PICKER_CANCELLED_CODES = ["E_PICKER_CANCELLED", "E_CROPPER_CANCELLED"] as const;
const CANCELLED_MESSAGES = ["user cancelled", "user canceled", "cancelled image selection"];

const isPickerCancellation = (error: unknown): boolean => {
  const err = error as { code?: string; message?: string };
  const code = err?.code ?? "";
  const message = (err?.message ?? "").toLowerCase();
  if (PICKER_CANCELLED_CODES.includes(code as (typeof PICKER_CANCELLED_CODES)[number])) return true;
  return CANCELLED_MESSAGES.some((m) => message.includes(m));
};

export const isPermissionError = (error: unknown): boolean => {
  const err = error as { code?: string; message?: string };
  const code = err?.code ?? "";
  const message = (err?.message ?? "").toLowerCase();
  if (code === "E_NO_LIBRARY_PERMISSION") return true;
  return /permission|grant|access denied|denied access/.test(message);
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
  if (isPickerCancellation(error)) {
    return { ok: false, cancelled: true };
  }
  return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
};

export const processImage = async (
  uri: string,
  size: number = DEFAULT_IMAGE_SIZE,
): Promise<string> => {
  const context = ImageManipulator.manipulate(ensureFileUri(uri));
  const imageRef = await context.resize({ width: size, height: size }).renderAsync();
  const result = await imageRef.saveAsync({ format: SaveFormat.WEBP, compress: IMAGE_QUALITY });
  return result.uri;
};

export const getFileSize = (uri: string): number | undefined => {
  const size = new FSFile(ensureFileUri(uri)).size;
  if (size === undefined) {
    console.error("Could not determine file size: file may not exist");
    return;
  }
  return size;
};

export const readImageBytes = async (uri: string): Promise<ArrayBuffer> => {
  const file = new FSFile(ensureFileUri(uri));
  const bytes = await file.bytes();
  return bytes.buffer;
};

export const computeSha256Base64 = async (bytes: ArrayBuffer): Promise<string> => {
  const hashBuffer = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new Uint8Array(bytes),
  );
  return arrayBufferToBase64(hashBuffer);
};

const parseS3ErrorBody = async (response: Response): Promise<string> => {
  const { data: body } = await tryCatch(response.text());
  if (!body) return "";

  const codeMatch = body.match(/<Code>(.+?)<\/Code>/);
  const messageMatch = body.match(/<Message>(.+?)<\/Message>/);
  const parts: string[] = [];
  if (codeMatch?.[1]) parts.push(codeMatch[1]);
  if (messageMatch?.[1]) parts.push(messageMatch[1]);
  return parts.join(": ");
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
    const detail = await parseS3ErrorBody(response);
    const summary = `Failed to upload image to S3 (HTTP ${response.status.toString()})`;
    throw new Error(detail ? `${summary}\n${detail}` : summary);
  }
};

export const cleanupTempFile = (uri: string): void => {
  const file = new FSFile(ensureFileUri(uri));
  if (file.exists) {
    file.delete();
  }
};
