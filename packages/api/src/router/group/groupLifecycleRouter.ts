import { GroupRole, Prisma } from "@openbeacon/database";
import { createGroupSchema, groupEpochBundleSchema, newGroupIdSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { deleteGroup } from "../../lib/deleteGroup.ts";
import { persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { assertAccountBelowGroupLimit } from "../../lib/groupLimit.ts";
import { groupOwnerProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";

export const groupLifecycleRouter = {
  delete: groupOwnerProcedure
    .meta({
      rateLimit: {
        limit: 32,
        windowMs: 60_000,
      },
    })
    .input(z.object({ groupId: z.string(), onlyIfLastMember: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
          );
          const actor = await tx.groupMember.findUnique({
            where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
          });
          if (actor?.role !== GroupRole.OWNER) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only owners can delete the group.",
            });
          }
          if (
            input.onlyIfLastMember &&
            (await tx.groupMember.count({ where: { groupId: input.groupId } })) !== 1
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "The group has other members. Please try leaving again.",
            });
          }
          await deleteGroup({ db: tx, groupId: input.groupId });
        },
        { timeout: 15_000 },
      );
      return { message: "Group deleted successfully" };
    }),
  create: protectedProcedure
    .meta({
      rateLimit: {
        limit: 32,
        windowMs: 60_000,
      },
    })
    .input(
      createGroupSchema.extend({
        groupId: newGroupIdSchema,
        initialEpoch: groupEpochBundleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.$transaction(async (tx) => {
        const [user] = await tx.$queryRaw<Array<{ pendingDeletion: boolean }>>(
          Prisma.sql`SELECT "pendingDeletion" FROM "User" WHERE id = ${ctx.session.user.id} FOR NO KEY UPDATE`,
        );
        const session = await tx.session.findFirst({
          where: { id: ctx.session.session.id, userId: ctx.session.user.id },
        });
        if (!user || user.pendingDeletion || !session)
          throw new TRPCError({ code: "UNAUTHORIZED" });
        await assertAccountBelowGroupLimit(tx, ctx.session.user.id);
        const createdGroup = await tx.group.create({
          data: {
            id: input.groupId,
            name: input.name,
            groupMembers: {
              create: {
                userId: ctx.session.user.id,
                role: GroupRole.OWNER,
                joinedEpochNumber: input.initialEpoch.epochNumber,
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
          deviceId: ctx.deviceId,
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
