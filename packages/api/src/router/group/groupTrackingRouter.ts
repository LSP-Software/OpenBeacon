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
import { ReasonError } from "../../lib/reasonError.ts";
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
      const userId = ctx.session.user.id;
      const uploadLimitReached = (limit: string) => {
        console.warn("[rate-limit] upload limit reached", { userId, limit });
        return new TRPCError({
          code: "TOO_MANY_REQUESTS",
          cause: new ReasonError("UPLOAD_LIMIT_REACHED"),
        });
      };
      const perMinute = await ctx.cache.rateLimits.consume(
        {
          namespace: "groupTracking.uploadBatch.points",
          identifier: { type: "userId", value: userId },
          limit: 2_000,
          windowMs: 60_000,
          cost: input.points.length,
        },
        { whenUnavailable: "allow" },
      );
      if (!perMinute.allowed) throw uploadLimitReached("points per minute");
      const result = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${ctx.session.user.id} FOR SHARE`,
        );
        const groups = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR SHARE`,
        );
        if (!groups.length) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This group no longer exists.",
            cause: new ReasonError("GROUP_GONE"),
          });
        }
        const members = await tx.$queryRaw<Array<{ id: string; createdAt: Date }>>(Prisma.sql`
          SELECT id, "createdAt" FROM "GroupMember"
          WHERE "groupId" = ${input.groupId} AND "userId" = ${ctx.session.user.id}
          FOR SHARE
        `);
        const member = members[0];
        if (!member) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this group",
            cause: new ReasonError("NOT_GROUP_MEMBER"),
          });
        }
        return uploadGroupTrackingBatch({
          db: tx,
          groupId: input.groupId,
          memberSince: member.createdAt,
          points: input.points,
          userId,
          consumeDailyBudget: async (acceptedPoints) => {
            const groupCount = await tx.groupMember.count({ where: { userId } });
            const budget = await ctx.cache.rateLimits.consume(
              {
                namespace: "groupTracking.uploadBatch.daily",
                identifier: { type: "userId", value: userId },
                limit: 9_504 + 8_640 * groupCount,
                windowMs: 86_400_000,
                cost: acceptedPoints,
              },
              { whenUnavailable: "allow" },
            );
            if (!budget.allowed) throw uploadLimitReached("daily points");
          },
        });
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const keyState = await tryCatch(
        Promise.race([
          getTrackingKeyState({
            db: ctx.db,
            deviceId: ctx.deviceId,
            userId: ctx.session.user.id,
          }),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 2_000);
          }),
        ]),
      );
      clearTimeout(timer);
      if (keyState.error || keyState.data === null) return { ...result };
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
        joinedEpochNumber: ctx.groupMember.joinedEpochNumber,
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
        joinedEpochNumber: ctx.groupMember.joinedEpochNumber,
      });
    }),
} satisfies TRPCRouterRecord;
