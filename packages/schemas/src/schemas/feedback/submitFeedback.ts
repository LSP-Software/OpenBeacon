import z from "zod";
import { emailSchema } from "../account/fields.ts";

export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;

const versionSchema = z.string().trim().min(1).max(100).optional();

export const submitFeedbackSchema = z.object({
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX_LENGTH),
  email: emailSchema.optional(),
  androidVersion: versionSchema,
  appVersion: versionSchema,
  maplibreVersion: versionSchema,
  serverVersion: versionSchema,
});
