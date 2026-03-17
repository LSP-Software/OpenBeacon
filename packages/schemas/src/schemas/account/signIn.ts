import z from "zod";
import { emailSchema, passwordSchema } from "./fields.ts";

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
