import {
  DEVICE_KEY_ALGORITHM,
  decodeBase64,
  encodeBase64,
  isUsableX25519PublicKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import z from "zod";

const devicePublicKeySchema = z
  .string()
  .transform((publicKey) => publicKey.trim())
  .refine((publicKey) => {
    if (publicKey.length !== 44) return false;
    try {
      const decoded = decodeBase64(publicKey);
      return encodeBase64(decoded) === publicKey && isUsableX25519PublicKey(decoded);
    } catch {
      return false;
    }
  }, "Invalid device public key.");

export const devicePlatformSchema = z.enum(["android", "ios"]);

export const registerDeviceKeySchema = z.object({
  algorithm: z.literal(DEVICE_KEY_ALGORITHM),
  deviceId: z.string().min(1).max(128),
  publicKey: devicePublicKeySchema,
  platform: devicePlatformSchema.optional(),
  model: z
    .string()
    .max(256)
    .optional()
    .transform((model) => {
      const trimmed = model?.trim();
      return trimmed && /^[\p{L}\p{N} ()+_-]{1,40}$/u.test(trimmed) ? trimmed : undefined;
    }),
});

export const encodedBytes = (length: number) =>
  z.string().refine((value) => {
    try {
      if (value.length !== Math.ceil(length / 3) * 4) return false;
      const bytes = decodeBase64(value);
      return bytes.length === length && encodeBase64(bytes) === value;
    } catch {
      return false;
    }
  }, "Invalid encoded key material.");

export const wrappedEpochKeySchema = z.object({
  algorithm: z.literal(WRAPPED_EPOCH_KEY_ALGORITHM),
  createdAt: z.date(),
  ephemeralPublicKey: encodedBytes(32),
  epochId: z.string().min(1).max(128),
  recipientDeviceId: z.string().min(1).max(128),
  senderPublicKey: encodedBytes(32),
  wrappedKey: encodedBytes(48),
});

export const historyKeyVersionSchema = z.number().int().positive();

export const wrappedHistoryEpochKeySchema = z.strictObject({
  algorithm: z.literal(WRAPPED_EPOCH_KEY_ALGORITHM),
  ephemeralPublicKey: encodedBytes(32),
  epochId: z.string().min(1).max(128),
  historyKeyVersion: historyKeyVersionSchema,
  senderPublicKey: encodedBytes(32),
  userId: z.string().min(1).max(128),
  wrappedKey: encodedBytes(48),
});

export const HISTORY_RECIPIENT_MISMATCH_MESSAGE =
  "Epoch history recipients do not match the members' current history keys.";

export const groupEpochBundleSchema = z
  .object({
    createdByDeviceId: z.string().min(1).max(128),
    epochId: z.string().min(1).max(128),
    epochNumber: z.number().int().positive(),
    historyKeys: z.array(wrappedHistoryEpochKeySchema),
    recipientKeys: z.array(wrappedEpochKeySchema).min(1),
  })
  .superRefine(({ epochId, recipientKeys }, ctx) => {
    recipientKeys.forEach((recipient, index) => {
      if (recipient.epochId !== epochId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recipient key epochId must match bundle epochId.",
          path: ["recipientKeys", index, "epochId"],
        });
      }
    });
  });
