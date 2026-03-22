import { GroupRole } from "@openbeacon/database/enums";
import z from "zod";

const baseInviteMemberToGroupSchema = z.object({
  groupId: z.string({ message: "Invalid group ID" }),
  invites: z
    .array(
      z.object({
        email: z.email({ message: "Invalid email address" }),
        role: z.enum([GroupRole.ADMIN, GroupRole.MEMBER], {
          message: "Invalid role",
        }),
      }),
    )
    .min(1, { message: "At least one invite is required" }),
});

export const createInviteMemberToGroupSchema = (currentUserEmail?: string) =>
  baseInviteMemberToGroupSchema.superRefine((value, ctx) => {
    if (!currentUserEmail) return;
    const normalizedCurrentUserEmail = currentUserEmail.trim().toLowerCase();

    value.invites.forEach((invite, index) => {
      if (invite.email.trim().toLowerCase() === normalizedCurrentUserEmail) {
        ctx.addIssue({
          code: "custom",
          message: "You cannot invite your own email address",
          path: ["invites", index, "email"],
        });
      }
    });
  });

export const inviteMemberToGroupSchema = createInviteMemberToGroupSchema();
