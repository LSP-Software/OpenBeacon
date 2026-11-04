import { signUpSchema } from "@openbeacon/schemas";
import { z } from "zod";

export const signUpFormSchema = signUpSchema
  .extend({ confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
