import { groupCrashAlertsSchema, sendCrashAlertsSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { readGroupCrashAlerts, sendCrashAlerts } from "../lib/crashAlerts.ts";
import { groupMemberProcedure } from "../procedures/auth/group.ts";
import { protectedProcedure, requireThisDevice } from "../procedures/auth/runtime.ts";

export const crashAlertsRouter = {
  send: protectedProcedure
    .use(requireThisDevice)
    .meta({ rateLimit: { limit: 60, windowMs: 3_600_000 } })
    .input(sendCrashAlertsSchema)
    .mutation(async ({ ctx, input }) => {
      const { rowIds, ...result } = await sendCrashAlerts({
        copies: input.copies,
        db: ctx.db,
        deviceId: ctx.deviceId,
        userId: ctx.session.user.id,
      });
      ctx.push?.crashAlerts(rowIds);
      return result;
    }),
  group: groupMemberProcedure
    .meta({ rateLimit: { limit: 120, windowMs: 60_000 } })
    .input(groupCrashAlertsSchema)
    .query(async ({ ctx, input }) =>
      readGroupCrashAlerts({
        db: ctx.db,
        groupId: input.groupId,
        memberSince: ctx.groupMember.createdAt,
      }),
    ),
} satisfies TRPCRouterRecord;
