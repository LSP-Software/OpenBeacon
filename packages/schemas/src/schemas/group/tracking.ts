import {
  decodeBase64,
  ENCRYPTED_TRACKING_POINT_LENGTH,
  encodeBase64,
  TRACKING_POINT_KIND,
  XCHACHA20_NONCE_LENGTH,
} from "@openbeacon/encryption";
import z from "zod";
import { alertsCursorSchema, placeTransitionSchema } from "./placeTransitions.ts";

const decodesTo = (value: string, isValid: (decoded: Uint8Array) => boolean) => {
  try {
    const decoded = decodeBase64(value);
    return isValid(decoded) && encodeBase64(decoded) === value;
  } catch {
    return false;
  }
};

export const groupPayloadNonceSchema = z
  .string()
  .min(1)
  .refine(
    (nonce) =>
      nonce.length === 32 &&
      decodesTo(nonce, (decoded) => decoded.length === XCHACHA20_NONCE_LENGTH),
    "Invalid payload nonce.",
  );

export const TRACKING_POINT_ROLES = ["POINT", "STAY", "LIVE"] as const;

export const groupTrackingPointSchema = z.object({
  ciphertext: z
    .string()
    .length(Math.ceil(ENCRYPTED_TRACKING_POINT_LENGTH / 3) * 4)
    .refine(
      (ciphertext) =>
        decodesTo(ciphertext, (decoded) => decoded.length === ENCRYPTED_TRACKING_POINT_LENGTH),
      "Invalid ciphertext.",
    ),
  clientPointId: z
    .string()
    .regex(
      /^(s\d{1,9}\.\d{1,9}:)?[A-Za-z0-9+/]{10}[AEIMQUYcgkosw048]=$/,
      "Invalid client point ID.",
    ),
  epochId: z.string().min(1).max(128),
  nonce: groupPayloadNonceSchema,
  role: z.enum(TRACKING_POINT_ROLES),
  senderDeviceId: z.string().min(1).max(128),
});

export const groupTrackingUploadBatchSchema = z
  .object({
    groupId: z.string().min(1),
    points: z.array(groupTrackingPointSchema).max(100),
    placeTransitions: z
      .array(placeTransitionSchema)
      .max(50)
      .refine(
        (transitions) =>
          new Set(transitions.map(({ clientId }) => clientId)).size === transitions.length,
        { message: "Each place transition can only be sent once per request" },
      )
      .optional(),
    placeAlertsCursor: alertsCursorSchema.nullable().optional(),
    noticesCursor: alertsCursorSchema.nullable().optional(),
  })
  .refine(
    (batch) =>
      batch.points.length > 0 ||
      (batch.placeTransitions?.length ?? 0) > 0 ||
      batch.placeAlertsCursor !== undefined ||
      batch.noticesCursor !== undefined,
    {
      message: "An upload needs at least one point, place transition or cursor",
      path: ["points"],
    },
  );

export const groupTrackingPollSchema = z.object({
  cursor: z
    .object({
      senderDeviceId: z.string().min(1).max(128),
      updatedAt: z.date(),
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

export const groupTrackingHistoryDaysSchema = z.object({
  groupId: z.string().min(1),
});

export const groupTrackingHistoryRangeSchema = z
  .object({
    groupId: z.string().min(1),
    from: z.date(),
    to: z.date(),
    cursor: z
      .object({
        receivedAt: z.date(),
        streamId: z.string().regex(/^\d{1,19}$/),
        pointId: z.string().regex(/^-?\d{1,19}$/),
      })
      .optional(),
    limit: z.number().int().min(1).max(2_000).optional(),
  })
  .refine((range) => range.from.getTime() < range.to.getTime(), {
    message: "from must be before to",
    path: ["to"],
  })
  .refine((range) => range.to.getTime() - range.from.getTime() <= 52 * 60 * 60_000, {
    message: "A history range can be at most 52 hours long",
    path: ["to"],
  });
