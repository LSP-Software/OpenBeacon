import {
  decodeBase64,
  encodeBase64,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
  XCHACHA20_NONCE_LENGTH,
} from "@openbeacon/encryption";
import z from "zod";

const trackingNonceSchema = z
  .string()
  .min(1)
  .refine((nonce) => {
    if (nonce.length !== 32) return false;
    try {
      const decoded = decodeBase64(nonce);
      return decoded.length === XCHACHA20_NONCE_LENGTH && encodeBase64(decoded) === nonce;
    } catch {
      return false;
    }
  }, "Invalid tracking point nonce.");

export const groupTrackingPointSchema = z.object({
  algorithm: z.literal(PAYLOAD_ENCRYPTION_ALGORITHM),
  ciphertext: z.string().min(1).max(4096),
  clientPointId: z.string().min(1).max(128),
  epochId: z.string().min(1).max(128),
  kind: z.literal(TRACKING_POINT_KIND),
  nonce: trackingNonceSchema,
  senderDeviceId: z.string().min(1).max(128),
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

export { TRACKING_POINT_KIND };
