import { removeGroupMemberSchema } from "@openbeacon/schemas";
import { GroupRole, Prisma } from "@openbeacon/database";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { getGroupRemovalContext, persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";
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
  removalContext: groupMemberProcedure
    .input(z.object({ groupId: z.string().min(1), memberId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      if (
        ctx.groupMember.id !== input.memberId &&
        ctx.groupMember.role !== GroupRole.OWNER &&
        ctx.groupMember.role !== GroupRole.ADMIN
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot remove this member." });
      }
      return getGroupRemovalContext({
        db: ctx.db,
        groupId: input.groupId,
        memberId: input.memberId,
      });
    }),
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
  remove: groupMemberProcedure
    .meta({
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
      },
    })
    .input(removeGroupMemberSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actors = await tx.$queryRaw<Array<{ id: string; role: GroupRole }>>(Prisma.sql`
          SELECT id, role FROM "GroupMember"
          WHERE "groupId" = ${input.groupId} AND "userId" = ${ctx.session.user.id}
          FOR UPDATE
        `);
        const actor = actors[0];
        if (
          !actor ||
          (actor.id !== input.memberId &&
            actor.role !== GroupRole.OWNER &&
            actor.role !== GroupRole.ADMIN)
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot remove this member." });
        }
        const member = await tx.groupMember.findFirst({
          where: { groupId: input.groupId, id: input.memberId },
          select: { userId: true, role: true },
        });
        if (!member) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Group member not found" });
        }
        if (
          actor.id !== input.memberId &&
          actor.role !== GroupRole.OWNER &&
          member.role !== GroupRole.MEMBER
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only owners can remove owners or admins.",
          });
        }

        if (input.successorMemberId) {
          if (
            actor.id !== input.memberId ||
            actor.role !== GroupRole.OWNER ||
            input.successorMemberId === input.memberId
          ) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only a departing owner can select a successor.",
            });
          }
          const successor = await tx.groupMember.findFirst({
            where: { id: input.successorMemberId, groupId: input.groupId },
          });
          if (!successor)
            throw new TRPCError({ code: "NOT_FOUND", message: "Successor not found." });
          await tx.groupMember.update({
            where: { id: successor.id },
            data: { role: GroupRole.OWNER },
          });
        }

        await persistGroupEpoch({
          db: tx,
          epoch: input.nextEpoch,
          excludedUserId: member.userId,
          groupId: input.groupId,
          userId: ctx.session.user.id,
        });

        await removeGroupMemberWithOwnerGuard({
          db: tx,
          groupId: input.groupId,
          memberId: input.memberId,
        });

        await tx.groupEncryptedPayload.deleteMany({
          where: { groupId: input.groupId, senderUserId: member.userId },
        });

        return {
          message: "Group member removed.",
        };
      });
    }),
  updateRole: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        memberId: z.string().min(1),
        role: z.enum(GroupRole),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actor = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
        });
        if (actor?.role !== GroupRole.OWNER) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only owners can change roles." });
        }
        const member = await tx.groupMember.findFirst({
          where: { id: input.memberId, groupId: input.groupId },
        });
        if (!member) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Group member not found" });
        }
        if (member.role === GroupRole.OWNER && input.role !== GroupRole.OWNER) {
          const owners = await tx.groupMember.count({
            where: { groupId: input.groupId, role: GroupRole.OWNER },
          });
          if (owners <= 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "The group must have at least one owner.",
            });
          }
        }
        return tx.groupMember.update({ where: { id: member.id }, data: { role: input.role } });
      });
    }),
} satisfies TRPCRouterRecord;
