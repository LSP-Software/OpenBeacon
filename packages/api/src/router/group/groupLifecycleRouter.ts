import { GroupRole } from "@openbeacon/database";
import { createGroupSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { protectedProcedure } from "../../procedures/auth/base.ts";
import { groupOwnerProcedure } from "../../procedures/auth/group.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";

export const groupLifecycleRouter = {
  delete: groupOwnerProcedure
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.group.delete({ where: { id: input.groupId } });
      return { message: "Group deleted successfully" };
    }),
  create: protectedProcedure.input(createGroupSchema).mutation(async ({ ctx, input }) => {
    const group = await ctx.db.group.create({
      data: {
        name: input.name,
        groupMembers: {
          create: {
            userId: ctx.session.user.id,
            role: GroupRole.OWNER,
          },
        },
      },
      include: {
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

    if (!group) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create group" });
    }

    return {
      message: "Group created successfully",
      newGroup: {
        id: group.id,
        name: group.name,
        image: group.image,
        members: group.groupMembers.map((member) => ({
          id: member.id,
          name: member.user.name,
          image: member.user.image,
          role: member.role,
        })),
      } satisfies GroupListItem,
    };
  }),
} satisfies TRPCRouterRecord;
