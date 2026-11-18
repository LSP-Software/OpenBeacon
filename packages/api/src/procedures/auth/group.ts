import { TRPCError } from "@trpc/server";
import z from "zod";
import { ReasonError } from "../../lib/reasonError.ts";
import { protectedProcedure } from "./runtime.ts";
import { isAdminOrEditor, notAdminOrEditorError } from "../../lib/groupRoles.ts";

export const groupMemberProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1).max(128) }))
  .use(async ({ ctx, next, input }) => {
    const groupMember = await ctx.db.groupMember.findUnique({
      where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
    });
    if (!groupMember) {
      const group = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        select: { id: true },
      });
      if (!group) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This group no longer exists.",
          cause: new ReasonError("GROUP_GONE"),
        });
      }
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this group",
        cause: new ReasonError("NOT_GROUP_MEMBER"),
      });
    }

    return next({
      ctx: { ...ctx, user: ctx.session.user, groupMember },
    });
  });

export const groupEditorProcedure = groupMemberProcedure.use(async ({ ctx, next }) => {
  if (!isAdminOrEditor(ctx.groupMember.role)) throw notAdminOrEditorError();

  return next({
    ctx: { ...ctx, user: ctx.session.user },
  });
});

export const groupOwnerProcedure = groupMemberProcedure.use(async ({ ctx, next }) => {
  const group = await ctx.db.group.findUnique({
    where: { id: ctx.groupMember.groupId },
    select: { ownerId: true },
  });
  if (group?.ownerId !== ctx.session.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not the owner of this group" });
  }

  return next({
    ctx: { ...ctx, user: ctx.session.user },
  });
});
