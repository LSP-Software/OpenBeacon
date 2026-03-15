import z from "zod";

export const inviteMemberToGroupSchema = z.object({
  email: z.email({ message: "Invalid email address" }),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"], { message: "Invalid role" }),
});
