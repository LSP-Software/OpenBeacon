import z from "zod";
import { sharedNameSchema } from "../account/fields.ts";

export const newGroupIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createGroupSchema = z.object({
  name: sharedNameSchema("Group name"),
});
