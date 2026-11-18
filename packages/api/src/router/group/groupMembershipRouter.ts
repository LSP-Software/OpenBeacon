import { GroupEventType, GroupRole, Prisma } from "@openbeacon/database";
import { devicePlatformSchema, removeGroupMemberSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { recordGroupEvent } from "../../lib/groupHistory.ts";
import { imageKeySelect, toStoredImageKey } from "../../lib/imageKeys.ts";
import { deleteTrackingStreams } from "../../lib/trackingCleanup.ts";
import { getGroupRemovalContext, persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";
import type { GroupListItem } from "../../types/GroupListItem.ts";
import { ReasonError } from "../../lib/reasonError.ts";
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
        ownerId: true,
        ownershipOfferedToId: true,
        ...imageKeySelect,
        groupMembers: {
          select: {
            id: true,
            role: true,
            ...imageKeySelect,
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
          imageKey: toStoredImageKey(group),
          ownerId: group.ownerId,
          ownershipOfferedToId: group.ownershipOfferedToId,
          members: group.groupMembers.map((member) => ({
            id: member.id,
            userId: member.user.id,
            name: member.user.name,
            image: member.user.image,
            imageKey: toStoredImageKey(member),
            role: member.role,
          })),
        }) satisfies GroupListItem,
    );
  }),
  get: groupMemberProcedure.query(async ({ ctx, input }) => {
    const group = await ctx.db.group.findUnique({ where: { id: input.groupId } });
    if (!group) throw new TRPCError({ code: "NOT_FOUND" });
    return { ...group, groupMembers: [ctx.groupMember] };
  }),
  removalContext: groupMemberProcedure
    .input(z.object({ groupId: z.string().min(1), memberId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      if (
        ctx.groupMember.id !== input.memberId &&
        ctx.groupMember.role !== GroupRole.ADMIN &&
        ctx.groupMember.role !== GroupRole.EDITOR
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot remove this member.",
        });
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
  listMemberDevices: groupMemberProcedure.query(async ({ ctx, input }) => {
    const devices = await ctx.db.userDevice.findMany({
      where: {
        revokedAt: null,
        activatedAt: { not: null },
        user: { groupMembers: { some: { groupId: input.groupId } } },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true, name: true, icon: true, platform: true },
    });
    return devices.map((device) => ({
      deviceId: device.id,
      userId: device.userId,
      name: device.name,
      icon: device.icon,
      platform: devicePlatformSchema.safeParse(device.platform).data ?? null,
    }));
  }),
  nicknames: groupMemberProcedure.query(async ({ ctx }) =>
    ctx.db.personalGroupNickname.findMany({
      where: { ownerId: ctx.groupMember.id },
      select: { targetId: true, ciphertext: true },
    }),
  ),
  updateNickname: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        memberId: z.string().min(1),
        ciphertext: z.string().min(1).max(50000).nullable(),
        expectedCiphertext: z.string().min(1).max(50000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.groupMember.findFirst({
        where: { id: input.memberId, groupId: input.groupId },
        select: { id: true },
      });
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Group member not found" });
      const where = { ownerId: ctx.groupMember.id, targetId: member.id };
      if (input.expectedCiphertext === null) {
        if (input.ciphertext === null) {
          const existing = await ctx.db.personalGroupNickname.findUnique({
            where: { ownerId_targetId: where },
            select: { ownerId: true },
          });
          if (existing)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Nickname changed. Reload and try again.",
            });
          return;
        }
        const created = await ctx.db.personalGroupNickname.createMany({
          data: { ...where, ciphertext: input.ciphertext },
          skipDuplicates: true,
        });
        if (created.count === 0)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Nickname changed. Reload and try again.",
          });
        return;
      }
      const result =
        input.ciphertext === null
          ? await ctx.db.personalGroupNickname.deleteMany({
              where: { ...where, ciphertext: input.expectedCiphertext },
            })
          : await ctx.db.personalGroupNickname.updateMany({
              where: { ...where, ciphertext: input.expectedCiphertext },
              data: { ciphertext: input.ciphertext },
            });
      if (result.count === 0)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Nickname changed. Reload and try again.",
        });
    }),
  colors: protectedProcedure.query(async ({ ctx }) => {
    const colors = await ctx.db.personalGroupColor.findMany({
      where: { owner: { userId: ctx.session.user.id } },
      select: { ciphertext: true, owner: { select: { groupId: true } } },
    });
    return colors.map((color) => ({ groupId: color.owner.groupId, ciphertext: color.ciphertext }));
  }),
  updateColor: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        ciphertext: z.string().min(1).max(50000),
        expectedCiphertext: z.string().min(1).max(50000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.expectedCiphertext !== undefined) {
        const result = await ctx.db.personalGroupColor.updateMany({
          where: { ownerId: ctx.groupMember.id, ciphertext: input.expectedCiphertext },
          data: { ciphertext: input.ciphertext },
        });
        if (result.count === 0)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Group colour changed. Reload and try again.",
          });
        return;
      }
      await ctx.db.personalGroupColor.upsert({
        where: { ownerId: ctx.groupMember.id },
        create: { ownerId: ctx.groupMember.id, ciphertext: input.ciphertext },
        update: { ciphertext: input.ciphertext },
      });
    }),
  remove: groupMemberProcedure
    .meta({
      rateLimit: {
        limit: 80,
        windowMs: 60_000,
      },
    })
    .input(removeGroupMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const removed = await ctx.db.$transaction(
        async (tx) => {
          const eventIds: string[] = [];
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
              actor.role !== GroupRole.ADMIN &&
              actor.role !== GroupRole.EDITOR)
          ) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You cannot remove this member.",
            });
          }
          const member = await tx.groupMember.findFirst({
            where: { groupId: input.groupId, id: input.memberId },
            select: { userId: true, role: true, group: { select: { ownerId: true } } },
          });
          if (!member) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Group member not found",
            });
          }
          if (member.group.ownerId === member.userId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                actor.id === input.memberId
                  ? "The owner can't leave the group. Transfer ownership or delete the group."
                  : "The group's owner can't be removed from the group.",
              cause: new ReasonError("GROUP_OWNER"),
            });
          }
          if (
            actor.id !== input.memberId &&
            actor.role !== GroupRole.ADMIN &&
            member.role !== GroupRole.MEMBER
          ) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only Admins can remove Admins or Editors.",
            });
          }

          const isLeaving = actor.id === input.memberId;
          if (!isLeaving) {
            await persistGroupEpoch({
              db: tx,
              deviceId: ctx.deviceId,
              epoch: input.nextEpoch,
              excludedUserId: member.userId,
              groupId: input.groupId,
              userId: ctx.session.user.id,
            });
          }

          await removeGroupMemberWithOwnerGuard({
            db: tx,
            groupId: input.groupId,
            memberId: input.memberId,
          });
          const departure = await recordGroupEvent(tx, {
            data: isLeaving
              ? {
                  groupId: input.groupId,
                  type: GroupEventType.MEMBER_LEFT,
                  subjectUserId: member.userId,
                }
              : {
                  groupId: input.groupId,
                  type: GroupEventType.MEMBER_REMOVED,
                  actorUserId: ctx.session.user.id,
                  subjectUserId: member.userId,
                },
          });
          eventIds.push(departure.id);

          await tx.groupEpochRecipientKey.deleteMany({
            where: {
              groupEpoch: { groupId: input.groupId },
              recipientDevice: { userId: member.userId },
            },
          });
          await tx.groupEpochHistoryWrap.deleteMany({
            where: {
              groupEpoch: { groupId: input.groupId },
              historyKey: { userId: member.userId },
            },
          });

          if (isLeaving) {
            await tx.group.update({
              where: { id: input.groupId },
              data: { epochRotationRequired: true },
            });
          }

          const [lastStream] = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`
            SELECT max(id)::text AS id FROM "TrackingStream"
            WHERE "groupId" = ${input.groupId} AND "senderUserId" = ${member.userId}
          `);
          return { userId: member.userId, lastStreamId: lastStream?.id ?? null, eventIds };
        },
        { timeout: 15_000 },
      );
      ctx.push?.groupEvents(removed.eventIds);
      const cleanup = await tryCatch(
        removed.lastStreamId === null
          ? Promise.resolve(0)
          : deleteTrackingStreams({
              db: ctx.db,
              streams: Prisma.sql`"stream"."groupId" = ${input.groupId} AND "stream"."senderUserId" = ${removed.userId} AND "stream"."id" <= ${removed.lastStreamId}::bigint`,
            }),
      );
      if (cleanup.error) {
        const code = errorCode(cleanup.error);
        console.error(`Removed member's location clean-up failed${code ? ` (${code})` : ""}`);
      }
      return {
        message: "Group member removed.",
      };
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
      const updated = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const actor = await tx.groupMember.findUnique({
          where: {
            userId_groupId: {
              userId: ctx.session.user.id,
              groupId: input.groupId,
            },
          },
        });
        if (actor?.role !== GroupRole.ADMIN) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only Admins can change roles.",
          });
        }
        const member = await tx.groupMember.findFirst({
          where: { id: input.memberId, groupId: input.groupId },
          include: {
            user: { select: { pendingDeletion: true } },
            group: { select: { ownerId: true, ownershipOfferedToId: true } },
          },
        });
        if (!member) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Group member not found",
          });
        }
        if (member.group.ownerId === member.userId && input.role !== GroupRole.ADMIN) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The group's owner is always an Admin.",
            cause: new ReasonError("GROUP_OWNER"),
          });
        }
        if (member.user.pendingDeletion && member.role !== input.role) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Cannot change the role of an account pending deletion.",
          });
        }
        if (input.role !== GroupRole.ADMIN && member.group.ownershipOfferedToId === member.userId) {
          await tx.group.update({
            where: { id: input.groupId },
            data: { ownershipOfferedToId: null, ownershipOfferedAt: null },
          });
        }
        if (input.role !== GroupRole.ADMIN) {
          await tx.groupMemberInvite.deleteMany({
            where: {
              groupId: input.groupId,
              inviterId: member.userId,
              ...(input.role === GroupRole.EDITOR ? { role: GroupRole.EDITOR } : {}),
            },
          });
        }
        if (input.role === GroupRole.MEMBER) {
          await tx.groupSharedInvite.deleteMany({
            where: { groupId: input.groupId, creatorId: member.userId, usedAt: null },
          });
        }
        const roleEvent =
          member.role === input.role
            ? null
            : await recordGroupEvent(tx, {
                data: {
                  groupId: input.groupId,
                  type: GroupEventType.ROLE_CHANGED,
                  actorUserId: ctx.session.user.id,
                  subjectUserId: member.userId,
                  role: input.role,
                },
              });
        return {
          member: await tx.groupMember.update({
            where: { id: member.id },
            data: { role: input.role },
          }),
          eventIds: roleEvent ? [roleEvent.id] : [],
        };
      });
      ctx.push?.groupEvents(updated.eventIds);
      return updated.member;
    }),
} satisfies TRPCRouterRecord;
