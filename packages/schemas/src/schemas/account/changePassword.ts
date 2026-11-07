import z from "zod";
import { passwordSchema } from "./fields.ts";

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: "Current password is required" }),
  newPassword: passwordSchema,
});
