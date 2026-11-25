import { deleteDrivesSchema, replaceDriveSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { replaceDriveCopies } from "../lib/drives.ts";
import { protectedProcedure, requireThisDevice } from "../procedures/auth/runtime.ts";

export const drivesRouter = {
  replace: protectedProcedure
    .use(requireThisDevice)
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(replaceDriveSchema)
    .mutation(async ({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        replaceDriveCopies({
          copies: input.copies,
          db: tx,
          driveId: input.driveId,
          userId: ctx.session.user.id,
        }),
      ),
    ),
  delete: protectedProcedure
    .use(requireThisDevice)
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(deleteDrivesSchema)
    .mutation(async ({ ctx, input }) => ({
      deleted: (
        await ctx.db.driveCopy.deleteMany({
          where: { driveId: { in: input.driveIds }, senderUserId: ctx.session.user.id },
        })
      ).count,
    })),
} satisfies TRPCRouterRecord;
