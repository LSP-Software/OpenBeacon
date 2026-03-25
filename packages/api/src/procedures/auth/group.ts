import { GroupRole } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import z from "zod";
import { protectedProcedure } from "./base.ts";

export const groupMemberProcedure = protectedProcedure
  .input(z.object({ groupId: z.string() }))
  .use(async ({ ctx, next, input }) => {
    const group = await ctx.db.group.findUnique({
      where: {
        id: input.groupId,
      },
      include: {
        groupMembers: {
          where: {
            userId: ctx.session.user.id,
          },
        },
      },
    });

    const groupMember = group?.groupMembers.find((member) => member.userId === ctx.session.user.id);
    if (!groupMember) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
    }

    return next({
      ctx: { ...ctx, user: ctx.session.user, group, groupMember },
    });
  });

export const groupAdminProcedure = groupMemberProcedure.use(async ({ ctx, next }) => {
  if (ctx.groupMember.role !== GroupRole.OWNER && ctx.groupMember.role !== GroupRole.ADMIN) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not an admin of this group" });
  }

  return next({
    ctx: { ...ctx, user: ctx.session.user },
  });
});

export const groupOwnerProcedure = groupMemberProcedure.use(async ({ ctx, next }) => {
  if (ctx.groupMember.role !== GroupRole.OWNER) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not the owner of this group" });
  }

  return next({
    ctx: { ...ctx, user: ctx.session.user },
  });
});
