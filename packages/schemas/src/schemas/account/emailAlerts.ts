import z from "zod";

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone.");

export const emailAlertSettingsSchema = z.object({
  alertNewDevice: z.boolean(),
  alertDeletionScheduled: z.boolean(),
});
