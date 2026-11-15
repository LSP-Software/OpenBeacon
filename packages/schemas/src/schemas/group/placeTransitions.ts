import z from "zod";

export const PLACE_TRANSITION_DIRECTIONS = ["ARRIVE", "LEAVE"] as const;

export const placeTransitionSchema = z.object({
  clientId: z.uuid(),
  placeId: z.string().min(1).max(128),
  direction: z.enum(PLACE_TRANSITION_DIRECTIONS),
  occurredAt: z.date(),
  senderDeviceId: z.string().min(1).max(128),
});

export const placeAlertsCursorSchema = z
  .string()
  .max(160)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[^|]{0,128}$/, {
    message: "Invalid place alerts cursor",
  })
  .refine((cursor) => !Number.isNaN(Date.parse(cursor.slice(0, cursor.indexOf("|")))), {
    message: "Invalid place alerts cursor",
  });

export const recentPlaceTransitionsSchema = z.object({
  groupId: z.string().min(1),
  before: z.object({ occurredAt: z.date(), id: z.string().min(1).max(128) }).optional(),
});

export const setPlaceSharingSchema = z.object({
  groupId: z.string().min(1),
  enabled: z.boolean(),
});

export const getPlaceSharingSchema = z.object({
  groupId: z.string().min(1),
});
