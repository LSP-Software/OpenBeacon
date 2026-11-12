import { z } from "zod";

const locationSharingChangeSchema = z.object({
  expectedUserId: z.string().min(1).max(128),
  paused: z.boolean(),
  durationMinutes: z
    .union([z.literal(15), z.literal(60), z.literal(480), z.literal(1440)])
    .nullable(),
});

export const setLocationSharingSchema = z.discriminatedUnion("scope", [
  locationSharingChangeSchema.extend({
    scope: z.literal("device"),
    deviceId: z.string().min(1).max(128),
  }),
  locationSharingChangeSchema.extend({ scope: z.literal("account") }),
]);
