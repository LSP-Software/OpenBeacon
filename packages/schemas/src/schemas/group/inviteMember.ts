import { GroupRole } from "@openbeacon/database/enums";
import z from "zod";

export const inviteMemberToGroupSchema = z.object({
  groupId: z.string({ message: "Invalid group ID" }),
  invites: z
    .array(
      z.object({
        email: z.email({ message: "Invalid email address" }),
        role: z.enum([GroupRole.OWNER, GroupRole.ADMIN, GroupRole.MEMBER], {
          message: "Invalid role",
        }),
      }),
    )
    .min(1, { message: "At least one invite is required" }),
});
