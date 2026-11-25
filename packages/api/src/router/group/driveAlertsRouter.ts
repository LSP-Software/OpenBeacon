import { Prisma } from "@openbeacon/database";
import { getDriveAlertMutesSchema, setDriveAlertMuteSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { lockGroupMemberForWrite } from "../../lib/groupWriteChecks.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

export const driveAlertsRouter = {
  mutes: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(getDriveAlertMutesSchema)
    .query(async ({ ctx, input }) => ({
      mutes: await ctx.db.driveAlertMute.findMany({
        where: { groupId: input.groupId, muterUserId: ctx.session.user.id },
        orderBy: { mutedUserId: "asc" },
        select: { mutedUserId: true },
      }),
    })),
  setMute: groupMemberProcedure
    .meta({ rateLimit: { limit: 120, windowMs: 60_000 } })
    .input(setDriveAlertMuteSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.mutedUserId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You don't get alerts about yourself.",
        });
      }
      return await ctx.db.$transaction(async (tx) => {
        await lockGroupMemberForWrite(tx, {
          groupId: input.groupId,
          groupLock: "FOR SHARE",
          userId,
        });
        if (input.mutedUserId !== null) {
          const members = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM "GroupMember"
            WHERE "userId" = ${input.mutedUserId} AND "groupId" = ${input.groupId}
            FOR KEY SHARE
          `);
          if (members.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "This person is no longer in the group.",
            });
          }
        }
        const mute = {
          groupId: input.groupId,
          muterUserId: userId,
          mutedUserId: input.mutedUserId,
        };
        if (input.muted) {
          await tx.driveAlertMute.createMany({ data: [mute], skipDuplicates: true });
        } else {
          await tx.driveAlertMute.deleteMany({ where: mute });
        }
        return { muted: input.muted };
      });
    }),
} satisfies TRPCRouterRecord;
