import { GroupRole } from "@openbeacon/database/enums";
import z from "zod";

export const inviteMemberToGroupSchema = z.object({
  groupId: z.string({ message: "Invalid group ID" }),
  invites: z.array(
    z.object({
      email: z.email({ message: "Invalid email address" }),
      role: z.enum(GroupRole, { message: "Invalid role" }),
    }),
  ),
});
