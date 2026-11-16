import { z } from "zod";
import { devicePlatformSchema } from "../auth/registerDeviceKey.ts";

export const appVersionSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);

export const compareAppVersions = (left: string, right: string) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

export const announcementMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(280)
  .regex(/^[^\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]*$/u, {
    message: "Use one line of text without control or text direction characters",
  });

export const announcementSchema = z.object({
  id: z.string().min(1).max(64),
  message: announcementMessageSchema,
  severity: z.enum(["info", "warning"]),
  platform: devicePlatformSchema.nullable(),
  minAppVersion: appVersionSchema.nullable(),
  maxAppVersion: appVersionSchema.nullable(),
  downtimeStartsAt: z.iso.datetime().nullable(),
  downtimeEndsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime(),
});

export type Announcement = z.infer<typeof announcementSchema>;
