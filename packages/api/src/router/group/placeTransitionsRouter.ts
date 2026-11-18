import { recentPlaceTransitionsSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { readRecentPlaceTransitions } from "../../lib/placeTransitions.ts";
import { assertNotOnHold } from "../../lib/seats.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

export const placeTransitionsRouter = {
  recent: groupMemberProcedure
    .meta({ rateLimit: { limit: 120, windowMs: 60_000 } })
    .input(recentPlaceTransitionsSchema)
    .query(async ({ ctx, input }) => {
      await assertNotOnHold(ctx, input.groupId);
      return readRecentPlaceTransitions({
        before: input.before,
        db: ctx.db,
        groupId: input.groupId,
        memberSince: ctx.groupMember.createdAt,
        now: new Date(),
      });
    }),
} satisfies TRPCRouterRecord;
