import { readDatabaseTime } from "@openbeacon/database";
import { groupHistorySchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { readGroupHistory, readGroupHistoryLatest } from "../../lib/groupHistory.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";

export const groupHistoryRouter = {
  list: groupMemberProcedure
    .meta({ rateLimit: { limit: 120, windowMs: 60_000 } })
    .input(groupHistorySchema)
    .query(async ({ ctx, input }) =>
      readGroupHistory({
        before: input.before,
        categories: input.categories,
        db: ctx.db,
        groupId: input.groupId,
        memberSince: ctx.groupMember.createdAt,
        now: await readDatabaseTime(ctx.db),
      }),
    ),
  latest: protectedProcedure
    .meta({ rateLimit: { limit: 120, windowMs: 60_000 } })
    .query(async ({ ctx }) =>
      readGroupHistoryLatest({
        db: ctx.db,
        now: await readDatabaseTime(ctx.db),
        userId: ctx.session.user.id,
      }),
    ),
} satisfies TRPCRouterRecord;
