import { Prisma } from "@openbeacon/database";
import { getPlaceAlertMutesSchema, setPlaceAlertMuteSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { lockGroupMemberForWrite } from "../../lib/groupWriteChecks.ts";
import { ReasonError } from "../../lib/reasonError.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

export const placeAlertsRouter = {
  mutes: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(getPlaceAlertMutesSchema)
    .query(async ({ ctx, input }) => ({
      mutes: await ctx.db.placeAlertMute.findMany({
        where: { groupId: input.groupId, muterUserId: ctx.session.user.id },
        orderBy: [{ placeId: "asc" }, { mutedUserId: "asc" }],
        select: { placeId: true, mutedUserId: true },
      }),
    })),
  setMute: groupMemberProcedure
    .meta({ rateLimit: { limit: 120, windowMs: 60_000 } })
    .input(setPlaceAlertMuteSchema)
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
        const places = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "Place"
          WHERE id = ${input.placeId} AND "groupId" = ${input.groupId}
          FOR KEY SHARE
        `);
        if (places.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This place no longer exists.",
            cause: new ReasonError("PLACE_GONE"),
          });
        }
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
          placeId: input.placeId,
          groupId: input.groupId,
          muterUserId: userId,
          mutedUserId: input.mutedUserId,
        };
        if (input.muted) {
          await tx.placeAlertMute.createMany({ data: [mute], skipDuplicates: true });
        } else {
          await tx.placeAlertMute.deleteMany({ where: mute });
        }
        return { muted: input.muted };
      });
    }),
} satisfies TRPCRouterRecord;
