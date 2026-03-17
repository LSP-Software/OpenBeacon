import z from "zod";

export const emailSchema = z.email({ error: "Invalid email address" }).trim();
export const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long" });
export const accountNameSchema = z.string().min(1, { message: "Name is required" }).trim();
