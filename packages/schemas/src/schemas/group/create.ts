import z from "zod";

export const createGroupSchema = z.object({
  name: z.string().min(1, { message: "Group name is required" }),
});
