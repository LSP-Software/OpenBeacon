import { accountNoticesSyncSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { readAccountNotices } from "../lib/accountNotices.ts";
import { protectedProcedure } from "../procedures/auth/runtime.ts";

export const accountNoticesRouter = {
  sync: protectedProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(accountNoticesSyncSchema)
    .mutation(async ({ ctx, input }) => {
      const pushAvailable = ctx.push?.enabled ?? false;
      if (input.pushToken === null) {
        await ctx.db.pushToken.deleteMany({ where: { deviceId: ctx.deviceId } });
      } else if (input.pushToken !== undefined && pushAvailable) {
        await ctx.db.$transaction([
          ctx.db.pushToken.deleteMany({
            where: { token: input.pushToken, deviceId: { not: ctx.deviceId } },
          }),
          ctx.db.pushToken.upsert({
            where: { deviceId: ctx.deviceId },
            create: { deviceId: ctx.deviceId, token: input.pushToken },
            update: { token: input.pushToken },
          }),
        ]);
      }
      const notices = await readAccountNotices({
        cursor: input.cursor,
        db: ctx.db,
        deviceId: ctx.deviceId,
        sessionCreatedAt: new Date(ctx.session.session.createdAt),
        userId: ctx.session.user.id,
      });
      return { ...notices, pushAvailable };
    }),
} satisfies TRPCRouterRecord;
