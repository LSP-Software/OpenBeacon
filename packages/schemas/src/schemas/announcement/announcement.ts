import { z } from "zod";

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

export const announcementMessageSchema = z.string().trim().min(1).max(280);

export const announcementSchema = z.object({
  id: z.string().min(1).max(64),
  message: announcementMessageSchema,
  severity: z.enum(["info", "warning"]),
  platform: z.enum(["android", "ios"]).nullable(),
  minAppVersion: appVersionSchema.nullable(),
  maxAppVersion: appVersionSchema.nullable(),
  downtimeStartsAt: z.iso.datetime().nullable(),
  downtimeEndsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime(),
});

export type Announcement = z.infer<typeof announcementSchema>;
