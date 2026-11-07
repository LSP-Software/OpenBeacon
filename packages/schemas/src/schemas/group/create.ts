import z from "zod";

export const newGroupIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, { message: "Group name is required" }).max(100),
});
