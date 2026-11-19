import z from "zod";
import { storableDateSchema } from "../storableDate.ts";

export const placeTransitionSchema = z.object({
  clientId: z.uuid(),
  placeId: z.string().min(1).max(128),
  direction: z.enum(["ARRIVE", "LEAVE"]),
  occurredAt: storableDateSchema,
  senderDeviceId: z.string().min(1).max(128),
});

export const alertsCursorSchema = z
  .string()
  .max(160)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[^|]{0,128}$/, {
    message: "Invalid alerts cursor",
  })
  .refine((cursor) => !Number.isNaN(Date.parse(cursor.slice(0, cursor.indexOf("|")))), {
    message: "Invalid alerts cursor",
  });

export const recentPlaceTransitionsSchema = z.object({
  groupId: z.string().min(1),
  before: z.object({ occurredAt: storableDateSchema, id: z.string().min(1).max(128) }).optional(),
});

export const groupHistoryCategorySchema = z.enum([
  "arrivals",
  "members",
  "roles",
  "group",
  "places",
]);

export const groupHistorySchema = z.object({
  groupId: z.string().min(1),
  before: z.object({ at: storableDateSchema, id: z.string().min(1).max(128) }).optional(),
  categories: z.array(groupHistoryCategorySchema).min(1).max(5).optional(),
});

export const setPlaceSharingSchema = z.object({
  groupId: z.string().min(1),
  enabled: z.boolean(),
});

export const getPlaceSharingSchema = z.object({
  groupId: z.string().min(1),
});

export const getPlaceAlertMutesSchema = z.object({
  groupId: z.string().min(1),
});

export const setPlaceAlertMuteSchema = z.object({
  groupId: z.string().min(1),
  placeId: z.string().min(1).max(128),
  mutedUserId: z.string().min(1).max(128).nullable(),
  muted: z.boolean(),
});
