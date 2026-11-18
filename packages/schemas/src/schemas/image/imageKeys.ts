import { ENCRYPTED_IMAGE_KEY_LENGTH, PAYLOAD_ENCRYPTION_ALGORITHM } from "@openbeacon/encryption";
import z from "zod";
import { encodedBytes } from "../auth/registerDeviceKey.ts";
import { groupPayloadNonceSchema } from "../group/tracking.ts";

export const MAX_IMAGE_KEY_REENCRYPTS = 100;

const groupIdSchema = z.string().min(1).max(128);

export const imageFileNameSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const imageKeyCiphertextSchema = encodedBytes(ENCRYPTED_IMAGE_KEY_LENGTH);

export const encryptedImageKeySchema = z.object({
  algorithm: z.literal(PAYLOAD_ENCRYPTION_ALGORITHM),
  ciphertext: imageKeyCiphertextSchema,
  epochId: z.string().min(1).max(128),
  nonce: groupPayloadNonceSchema,
  senderDeviceId: z.string().min(1).max(128),
});

export const confirmGroupImageUploadSchema = z.object({
  expectedFileName: imageFileNameSchema.nullable().optional(),
  groupId: groupIdSchema,
  key: encryptedImageKeySchema,
});

export const confirmProfileImageUploadSchema = z.object({
  wraps: z
    .array(encryptedImageKeySchema.extend({ groupId: groupIdSchema }))
    .max(64)
    .refine((wraps) => new Set(wraps.map(({ groupId }) => groupId)).size === wraps.length, {
      message: "Each group can only have one key",
    }),
  sealed: z.string().min(1).max(4096).optional(),
});

export const storeImageKeySchema = z.object({
  groupId: groupIdSchema,
  fileName: imageFileNameSchema,
  key: encryptedImageKeySchema,
});

const imageKeyTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group") }),
  z.object({ kind: z.literal("member"), memberId: z.string().min(1).max(128) }),
]);

export const reEncryptImageKeysSchema = z.object({
  groupId: groupIdSchema,
  keys: z
    .array(
      z.object({
        target: imageKeyTargetSchema,
        fileName: imageFileNameSchema,
        expectedCiphertext: imageKeyCiphertextSchema,
        key: encryptedImageKeySchema,
      }),
    )
    .min(1)
    .max(MAX_IMAGE_KEY_REENCRYPTS)
    .refine(
      (keys) =>
        new Set(keys.map(({ target }) => (target.kind === "group" ? "group" : target.memberId)))
          .size === keys.length,
      { message: "Each key can only be re-encrypted once per request" },
    ),
});
