import { z } from "zod";

const locationSharingChangeSchema = z.object({
  expectedUserId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0).nullable(),
  replacesRequestId: z.string().min(1).max(128).nullable(),
  paused: z.boolean(),
  durationMinutes: z
    .union([z.literal(15), z.literal(60), z.literal(480), z.literal(1440)])
    .nullable(),
  pausedUntil: z.date().nullable(),
  requestedAt: z.date(),
});

export const locationSharingChangeInputSchema = z
  .discriminatedUnion("scope", [
    locationSharingChangeSchema.extend({
      scope: z.literal("device"),
      deviceId: z.string().min(1).max(128),
    }),
    locationSharingChangeSchema.extend({ scope: z.literal("account") }),
  ])
  .refine(
    (change) =>
      change.paused
        ? (change.durationMinutes === null) === (change.pausedUntil === null)
        : change.durationMinutes === null &&
          change.pausedUntil === null &&
          (change.expectedRevision !== null || change.replacesRequestId !== null),
    {
      message: "A timed pause needs an end time, and a resume must say what it replaces.",
    },
  );

export const setLocationSharingSchema = locationSharingChangeInputSchema.refine(
  (change) => change.requestedAt.getTime() <= Date.now() + 24 * 60 * 60_000,
  { message: "A sharing change can't be requested in the future." },
);
