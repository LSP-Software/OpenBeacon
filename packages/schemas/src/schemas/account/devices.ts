import { DeviceIcon } from "@openbeacon/database/enums";
import z from "zod";

export const deviceIconSchema = z.enum(DeviceIcon);

export const deviceNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Name is required" })
  .max(40, { message: "Name must be at most 40 characters" })
  .refine((name) => !/[\p{Cc}\p{Cs}]/u.test(name), {
    message: "Name contains invalid characters",
  });

export const updateDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  name: deviceNameSchema.optional(),
  icon: deviceIconSchema.optional(),
});

export const removeDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
});
