import {
  decodeBase64,
  ENCRYPTED_TRACKING_POINT_LENGTH,
  encodeBase64,
  TRACKING_POINT_KIND,
  XCHACHA20_NONCE_LENGTH,
} from "@openbeacon/encryption";
import z from "zod";
import { alertsCursorSchema, placeTransitionSchema } from "./placeTransitions.ts";
import { storableDateSchema } from "../storableDate.ts";

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
  capturedHour: z.number().int().min(438_288).max(1_000_000).optional(),
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
      updatedAt: storableDateSchema,
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
    fromHour: z.number().int().min(0).max(1_000_000),
    toHour: z.number().int().min(0).max(1_000_000),
    cursor: z
      .object({
        capturedHour: z.number().int().min(-2_147_483_648).max(2_147_483_647),
        streamId: z
          .string()
          .regex(/^\d{1,19}$/)
          .refine((id) => BigInt(id) <= 9_223_372_036_854_775_807n),
        pointId: z
          .string()
          .regex(/^-?\d{1,19}$/)
          .refine(
            (id) =>
              BigInt(id) >= -9_223_372_036_854_775_808n && BigInt(id) <= 9_223_372_036_854_775_807n,
          ),
      })
      .optional(),
    limit: z.number().int().min(1).max(2_000).optional(),
  })
  .refine((range) => range.fromHour < range.toHour, {
    message: "fromHour must be before toHour",
    path: ["toHour"],
  })
  .refine((range) => range.toHour - range.fromHour <= 26, {
    message: "A history range can be at most 26 hours long",
    path: ["toHour"],
  });
