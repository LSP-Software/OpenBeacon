import {
  groupTrackingGetLatestSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
} from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { Prisma } from "@openbeacon/database";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import {
  getLatestGroupTrackingPoints,
  pollGroupTrackingPoints,
  uploadGroupTrackingBatch,
} from "../../lib/groupTracking.ts";
import { getTrackingKeyState } from "../../lib/trackingKeyState.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

const DEFAULT_POLL_LIMIT = 100;

export const groupTrackingRouter = {
  uploadBatch: groupMemberProcedure
    .meta({
      rateLimit: {
        limit: 240,
        windowMs: 60_000,
      },
    })
    .input(groupTrackingUploadBatchSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${ctx.session.user.id} FOR SHARE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const group = await tx.group.findUnique({ where: { id: input.groupId } });
        if (!group) throw new TRPCError({ code: "FORBIDDEN" });
        const members = await tx.$queryRaw<Array<{ id: string; createdAt: Date }>>(Prisma.sql`
          SELECT id, "createdAt" FROM "GroupMember"
          WHERE "groupId" = ${input.groupId} AND "userId" = ${ctx.session.user.id}
          FOR UPDATE
        `);
        const member = members[0];
        if (!member) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
        }
        return uploadGroupTrackingBatch({
          db: tx,
          groupId: input.groupId,
          memberSince: member.createdAt,
          points: input.points,
          userId: ctx.session.user.id,
        });
      });
      const keyState = await tryCatch(
        getTrackingKeyState({
          db: ctx.db,
          deviceId: ctx.deviceId,
          userId: ctx.session.user.id,
        }),
      );
      if (keyState.error) return { ...result };
      return { ...result, keyState: keyState.data };
    }),
  poll: groupMemberProcedure
    .meta({ rateLimit: { limit: 480, windowMs: 60_000 } })
    .input(groupTrackingPollSchema)
    .query(async ({ ctx, input }) => {
      return await pollGroupTrackingPoints({
        cursor: input.cursor,
        db: ctx.db,
        groupId: input.groupId,
        limit: input.limit ?? DEFAULT_POLL_LIMIT,
      });
    }),
  getLatest: groupMemberProcedure
    .meta({ rateLimit: { limit: 480, windowMs: 60_000 } })
    .input(groupTrackingGetLatestSchema)
    .query(async ({ ctx, input }) => {
      return await getLatestGroupTrackingPoints({
        db: ctx.db,
        groupId: input.groupId,
      });
    }),
} satisfies TRPCRouterRecord;
