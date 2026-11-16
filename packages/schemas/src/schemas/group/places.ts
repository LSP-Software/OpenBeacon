import { PAYLOAD_ENCRYPTION_ALGORITHM, PLACE_GEOMETRY_KIND } from "@openbeacon/encryption";
import z from "zod";
import { isVisibleName } from "../account/fields.ts";
import { groupPayloadNonceSchema } from "./tracking.ts";

export const MAX_PLACES_PER_GROUP = 50;

const singleEmojiPattern =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})?)*)$/u;

export const placeNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Name is required" })
  .max(50, { message: "Name must be at most 50 characters" })
  .refine(isVisibleName, {
    message: "Name contains invalid characters",
  });

export const placeEmojiSchema = z
  .string()
  .max(32)
  .regex(singleEmojiPattern, { message: "Choose one emoji" });

const placeCiphertextSchema = z.string().min(1).max(512);

const encryptedPlaceGeometrySchema = z.object({
  algorithm: z.literal(PAYLOAD_ENCRYPTION_ALGORITHM),
  ciphertext: placeCiphertextSchema,
  epochId: z.string().min(1).max(128),
  kind: z.literal(PLACE_GEOMETRY_KIND),
  nonce: groupPayloadNonceSchema,
  senderDeviceId: z.string().min(1).max(128),
});

const placeIdSchema = z.string().min(1).max(128);

export const createPlaceSchema = z.object({
  groupId: z.string().min(1),
  name: placeNameSchema,
  emoji: placeEmojiSchema,
  geometry: encryptedPlaceGeometrySchema,
});

export const updatePlaceSchema = z.object({
  groupId: z.string().min(1),
  placeId: placeIdSchema,
  name: placeNameSchema,
  emoji: placeEmojiSchema,
  geometry: encryptedPlaceGeometrySchema,
  expectedCiphertext: placeCiphertextSchema,
});

export const reEncryptPlacesSchema = z.object({
  groupId: z.string().min(1),
  places: z
    .array(
      z.object({
        placeId: placeIdSchema,
        name: placeNameSchema,
        emoji: placeEmojiSchema,
        expectedCiphertext: placeCiphertextSchema,
        geometry: encryptedPlaceGeometrySchema,
      }),
    )
    .min(1)
    .max(MAX_PLACES_PER_GROUP)
    .refine((places) => new Set(places.map(({ placeId }) => placeId)).size === places.length, {
      message: "Each place can only be re-encrypted once per request",
    }),
});

export const deletePlaceSchema = z.object({
  groupId: z.string().min(1),
  placeId: placeIdSchema,
});

export const listPlacesSchema = z.object({
  groupId: z.string().min(1),
});

export { PLACE_GEOMETRY_KIND };
