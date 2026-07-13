import {
  groupTrackingGetLatestSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
} from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import {
  getLatestGroupTrackingPoints,
  pollGroupTrackingPoints,
  uploadGroupTrackingBatch,
} from "../../lib/groupTracking.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

const DEFAULT_POLL_LIMIT = 100;

export const groupTrackingRouter = {
  uploadBatch: groupMemberProcedure
    .meta({
      rateLimit: {
        limit: 60,
        windowMs: 60_000,
      },
    })
    .input(groupTrackingUploadBatchSchema)
    .mutation(async ({ ctx, input }) => {
      return await uploadGroupTrackingBatch({
        db: ctx.db,
        groupId: input.groupId,
        points: input.points,
        userId: ctx.session.user.id,
      });
    }),
  poll: groupMemberProcedure.input(groupTrackingPollSchema).query(async ({ ctx, input }) => {
    return await pollGroupTrackingPoints({
      cursor: input.cursor,
      db: ctx.db,
      groupId: input.groupId,
      limit: input.limit ?? DEFAULT_POLL_LIMIT,
    });
  }),
  getLatest: groupMemberProcedure
    .input(groupTrackingGetLatestSchema)
    .query(async ({ ctx, input }) => {
      return await getLatestGroupTrackingPoints({
        db: ctx.db,
        groupId: input.groupId,
      });
    }),
} satisfies TRPCRouterRecord;
