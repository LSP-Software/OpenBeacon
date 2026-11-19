import {
  AccountNoticeType,
  GroupEventType,
  GroupRole,
  Prisma,
  readDatabaseTime,
} from "@openbeacon/database";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { recordGroupEvent } from "../../lib/groupHistory.ts";
import { groupGoneError, notOwnerError } from "../../lib/groupRoles.ts";
import { ReasonError } from "../../lib/reasonError.ts";
import {
  freeSeatCount,
  freeSeats,
  groupSeats,
  lockOwnerThenGroup,
  noFreeSeatsError,
  seatCount,
  seatsEnforced,
} from "../../lib/seats.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";

const lockGroup = async (tx: Prisma.TransactionClient, groupId: string) => {
  const [group] = await tx.$queryRaw<
    Array<{ ownerId: string; ownershipOfferedToId: string | null }>
  >(
    Prisma.sql`SELECT "ownerId", "ownershipOfferedToId" FROM "Group" WHERE id = ${groupId} FOR UPDATE`,
  );
  if (!group) throw groupGoneError();
  return group;
};

const offerGone = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "This request to take over the group is no longer open.",
    cause: new ReasonError("OWNERSHIP_OFFER_GONE"),
  });

export const groupOwnershipRouter = {
  offer: groupMemberProcedure
    .meta({ rateLimit: { limit: 10, windowMs: 3_600_000 } })
    .input(z.object({ groupId: z.string().min(1).max(128), memberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const noticeId = await ctx.db.$transaction(async (tx) => {
        const group = await lockGroup(tx, input.groupId);
        if (group.ownerId !== ctx.session.user.id) throw notOwnerError();
        const member = await tx.groupMember.findFirst({
          where: { id: input.memberId, groupId: input.groupId },
          select: { userId: true, role: true, user: { select: { pendingDeletion: true } } },
        });
        if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Group member not found" });
        if (member.userId === ctx.session.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You already own this group." });
        }
        if (member.role !== GroupRole.ADMIN) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only an Admin can become the owner. Make them an Admin first.",
          });
        }
        if (member.user.pendingDeletion) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This account is being deleted.",
          });
        }
        if (group.ownershipOfferedToId === member.userId) return null;
        const offeredAt = await readDatabaseTime(tx);
        await tx.group.update({
          where: { id: input.groupId },
          data: { ownershipOfferedToId: member.userId, ownershipOfferedAt: offeredAt },
        });
        const notice = await tx.accountNotice.create({
          data: {
            userId: member.userId,
            type: AccountNoticeType.OWNERSHIP_OFFERED,
            groupId: input.groupId,
            createdAt: offeredAt,
          },
          select: { id: true },
        });
        return notice.id;
      });
      if (noticeId) ctx.push?.accountNotice(noticeId);
    }),
  cancel: groupMemberProcedure.mutation(async ({ ctx, input }) => {
    await ctx.db.$transaction(async (tx) => {
      const group = await lockGroup(tx, input.groupId);
      if (group.ownerId !== ctx.session.user.id) throw notOwnerError();
      await tx.group.update({
        where: { id: input.groupId },
        data: { ownershipOfferedToId: null, ownershipOfferedAt: null },
      });
    });
  }),
  offers: protectedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db.group.findMany({
      where: { ownershipOfferedToId: ctx.session.user.id },
      orderBy: { ownershipOfferedAt: "asc" },
      select: {
        id: true,
        name: true,
        ownershipOfferedAt: true,
        owner: { select: { id: true, name: true } },
      },
    });
    return Promise.all(
      groups.map(async (group) => ({
        groupId: group.id,
        groupName: group.name,
        owner: { userId: group.owner.id, name: group.owner.name },
        offeredAt: group.ownershipOfferedAt,
        seats: seatsEnforced(ctx) ? await groupSeats(ctx.db, group.id) : null,
      })),
    );
  }),
  decline: groupMemberProcedure.mutation(async ({ ctx, input }) => {
    await ctx.db.$transaction(async (tx) => {
      const group = await lockGroup(tx, input.groupId);
      if (group.ownershipOfferedToId !== ctx.session.user.id) throw offerGone();
      await tx.group.update({
        where: { id: input.groupId },
        data: { ownershipOfferedToId: null, ownershipOfferedAt: null },
      });
    });
  }),
  accept: groupMemberProcedure.mutation(async ({ ctx, input }) => {
    const eventId = await ctx.db.$transaction(async (tx) => {
      const ownerId = await lockOwnerThenGroup({
        db: tx,
        groupId: input.groupId,
        userIds: [ctx.session.user.id],
      });
      if (!ownerId) throw groupGoneError();
      const group = await lockGroup(tx, input.groupId);
      if (group.ownershipOfferedToId !== ctx.session.user.id) throw offerGone();
      const owner = await tx.user.findUnique({
        where: { id: group.ownerId },
        select: { pendingDeletion: true },
      });
      if (!owner || owner.pendingDeletion) throw offerGone();
      const member = await tx.groupMember.findUnique({
        where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
        select: { role: true, user: { select: { pendingDeletion: true } } },
      });
      if (member?.role !== GroupRole.ADMIN || member.user.pendingDeletion) throw offerGone();
      if (seatsEnforced(ctx)) {
        const [{ free }, needed] = await Promise.all([
          freeSeats(tx, ctx.session.user.id),
          groupSeats(tx, input.groupId),
        ]);
        if (needed > free) {
          throw noFreeSeatsError(
            `Taking over this group needs ${seatCount(needed)} and you have ${freeSeatCount(free)}. Add seats first.`,
          );
        }
      }
      await tx.group.update({
        where: { id: input.groupId },
        data: {
          ownerId: ctx.session.user.id,
          ownershipOfferedToId: null,
          ownershipOfferedAt: null,
        },
      });
      const event = await recordGroupEvent(tx, {
        data: {
          groupId: input.groupId,
          type: GroupEventType.OWNER_CHANGED,
          actorUserId: ctx.session.user.id,
          subjectUserId: group.ownerId,
        },
      });
      return event.id;
    });
    ctx.push?.groupEvents([eventId]);
  }),
} satisfies TRPCRouterRecord;
