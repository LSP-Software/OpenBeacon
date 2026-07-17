import { GroupRole } from "@openbeacon/database";
import { createGroupSchema, groupEpochBundleSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { groupOwnerProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";

export const groupLifecycleRouter = {
  delete: groupOwnerProcedure
    .meta({
      rateLimit: {
        limit: 5,
        windowMs: 60_000,
      },
    })
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.group.delete({ where: { id: input.groupId } });
      return { message: "Group deleted successfully" };
    }),
  create: protectedProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
    .input(
      createGroupSchema.extend({
        groupId: z.string().min(1),
        initialEpoch: groupEpochBundleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.$transaction(async (tx) => {
        const createdGroup = await tx.group.create({
          data: {
            id: input.groupId,
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

        await persistGroupEpoch({
          db: tx,
          epoch: input.initialEpoch,
          groupId: input.groupId,
          userId: ctx.session.user.id,
        });

        return createdGroup;
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
            userId: member.user.id,
            name: member.user.name,
            image: member.user.image,
            role: member.role,
          })),
        } satisfies GroupListItem,
      };
    }),
} satisfies TRPCRouterRecord;
