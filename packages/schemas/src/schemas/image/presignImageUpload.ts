import { MIN_ENCRYPTED_IMAGE_LENGTH } from "@openbeacon/encryption";
import z from "zod";
import { imageFileNameSchema } from "./imageKeys.ts";

export const presignImageUploadInputSchema = ({
  maxImageFileSize,
}: {
  maxImageFileSize: number;
}) => {
  return z.object({
    fileName: imageFileNameSchema,
    fileSize: z.number().int().max(maxImageFileSize).min(MIN_ENCRYPTED_IMAGE_LENGTH),
    contentHash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  });
};
