import z from "zod";

export const inviteMemberToGroupSchema = z.object({
  invites: z.array(
    z.object({
      email: z.email({ message: "Invalid email address" }),
      role: z.enum(["ADMIN", "MEMBER"], { message: "Invalid role" }),
    }),
  ),
});
