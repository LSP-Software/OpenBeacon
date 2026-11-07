import z from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Invalid email address" }).max(320, { error: "Invalid email address" }));
export const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long" });
export const accountNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Name is required" })
  .max(100, { message: "Name must be at most 100 characters" })
  .refine((name) => !/[\p{Cc}\p{Cs}]/u.test(name), {
    message: "Name contains invalid characters",
  });
