import { removeGroupMemberSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { getGroupRemovalContext, persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { groupAdminProcedure, groupMemberProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";
import { removeGroupMemberWithOwnerGuard } from "./assertGroupMemberCanBeRemoved.ts";

export const groupMembershipRouter = {
  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      where: {
        groupMembers: {
          some: {
            userId: ctx.session.user.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        image: true,
        groupMembers: {
          select: {
            id: true,
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
    });

    return groups.map(
      (group) =>
        ({
          id: group.id,
          name: group.name,
          image: group.image,
          members: group.groupMembers.map((member) => ({
            id: member.id,
            userId: member.user.id,
            name: member.user.name,
            image: member.user.image,
            role: member.role,
          })),
        }) satisfies GroupListItem,
    );
  }),
  get: groupMemberProcedure.query(async ({ ctx }) => {
    return ctx.group;
  }),
  removalContext: groupAdminProcedure
    .input(z.object({ groupId: z.string().min(1), memberId: z.string().min(1) }))
    .query(async ({ ctx, input }) =>
      getGroupRemovalContext({
        db: ctx.db,
        groupId: input.groupId,
        memberId: input.memberId,
      }),
    ),
  members: groupMemberProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.groupMember.findMany({
        where: { groupId: input.groupId },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          role: true,
        },
      });
    }),
  remove: groupAdminProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
    .input(removeGroupMemberSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        await removeGroupMemberWithOwnerGuard({
          db: tx,
          groupId: input.groupId,
          memberId: input.memberId,
        });

        await persistGroupEpoch({
          db: tx,
          epoch: input.nextEpoch,
          groupId: input.groupId,
          userId: ctx.session.user.id,
        });

        return {
          message: "Group member removed.",
        };
      });
    }),
} satisfies TRPCRouterRecord;
