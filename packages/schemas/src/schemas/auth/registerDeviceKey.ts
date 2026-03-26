import { DEVICE_KEY_ALGORITHM, WRAPPED_EPOCH_KEY_ALGORITHM } from "@openbeacon/encryption";
import z from "zod";

export const registerDeviceKeySchema = z.object({
  algorithm: z.literal(DEVICE_KEY_ALGORITHM),
  deviceId: z.string().min(1),
  publicKey: z.string().min(1),
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

export const groupEpochBundleSchema = z.object({
  createdByDeviceId: z.string().min(1),
  epochId: z.string().min(1),
  epochNumber: z.number().int().positive(),
  recipientKeys: z.array(wrappedEpochKeySchema).min(1),
});
