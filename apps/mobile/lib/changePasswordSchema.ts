import { changePasswordSchema } from "@openbeacon/schemas";
import { z } from "zod";

export const changePasswordFormSchema = changePasswordSchema
  .extend({ confirmNewPassword: z.string() })
  .refine((values) => values.newPassword === values.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Passwords do not match",
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from your current password",
  });
