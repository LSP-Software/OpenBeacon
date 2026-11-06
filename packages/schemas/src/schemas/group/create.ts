import z from "zod";

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, { message: "Group name is required" }).max(100),
});
