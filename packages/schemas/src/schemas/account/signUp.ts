import z from "zod";
import { accountNameSchema, emailSchema, passwordSchema } from "./fields.ts";

export const signUpSchema = z.object({
  name: accountNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
