import {
  DEVICE_KEY_ALGORITHM,
  decodeBase64,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import z from "zod";

const devicePublicKeySchema = z
  .string()
  .transform((publicKey) => publicKey.trim())
  .refine((publicKey) => {
    try {
      return decodeBase64(publicKey).length === 32;
    } catch {
      return false;
    }
  }, "Invalid device public key.");

export const registerDeviceKeySchema = z.object({
  algorithm: z.literal(DEVICE_KEY_ALGORITHM),
  deviceId: z.string().min(1),
  publicKey: devicePublicKeySchema,
});

export const wrappedEpochKeySchema = z.object({
  algorithm: z.literal(WRAPPED_EPOCH_KEY_ALGORITHM),
  createdAt: z.date(),
  ephemeralPublicKey: z.string().min(1),
  epochId: z.string().min(1),
  nonce: z.string().min(1),
  recipientDeviceId: z.string().min(1),
  wrappedKey: z.string().min(1),
});

export const groupEpochBundleSchema = z
  .object({
    createdByDeviceId: z.string().min(1),
    epochId: z.string().min(1),
    epochNumber: z.number().int().positive(),
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
