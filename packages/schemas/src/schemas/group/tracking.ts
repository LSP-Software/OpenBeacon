import {
  decodeBase64,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  XCHACHA20_NONCE_LENGTH,
} from "@openbeacon/encryption";
import z from "zod";

export const TRACKING_POINT_KIND = "trackingPoint" as const;

const trackingNonceSchema = z
  .string()
  .min(1)
  .refine((nonce) => {
    try {
      return decodeBase64(nonce).length === XCHACHA20_NONCE_LENGTH;
    } catch {
      return false;
    }
  }, "Invalid tracking point nonce.");

export const groupTrackingPointSchema = z.object({
  algorithm: z.literal(PAYLOAD_ENCRYPTION_ALGORITHM),
  ciphertext: z.string().min(1),
  clientPointId: z.string().min(1),
  epochId: z.string().min(1),
  kind: z.literal(TRACKING_POINT_KIND),
  nonce: trackingNonceSchema,
  senderDeviceId: z.string().min(1),
});

export const groupTrackingUploadBatchSchema = z.object({
  groupId: z.string().min(1),
  points: z.array(groupTrackingPointSchema).min(1).max(100),
});

export const groupTrackingPollSchema = z.object({
  cursor: z
    .object({
      createdAt: z.date(),
      id: z.string().min(1),
    })
    .nullable()
    .optional(),
  groupId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
});

export const groupTrackingGetLatestSchema = z.object({
  groupId: z.string().min(1),
});
