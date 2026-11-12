import { z } from "zod";

export const setLocationSharingSchema = z.object({
  scope: z.enum(["device", "account"]),
  deviceId: z.string().min(1).max(128).optional(),
  paused: z.boolean(),
  durationMinutes: z
    .union([z.literal(15), z.literal(60), z.literal(480), z.literal(1440)])
    .nullable(),
});
