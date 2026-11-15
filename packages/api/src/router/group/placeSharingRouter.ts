import { getPlaceSharingSchema, setPlaceSharingSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { assertActiveDevices, lockGroupMemberForWrite } from "../../lib/groupWriteChecks.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

export const placeSharingRouter = {
  get: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(getPlaceSharingSchema)
    .query(async ({ ctx, input }) => {
      const off = await ctx.db.placeSharing.findMany({
        where: {
          groupId: input.groupId,
          enabled: false,
          device: { revokedAt: null, activatedAt: { not: null } },
        },
        orderBy: [{ userId: "asc" }, { deviceId: "asc" }],
        select: { userId: true, deviceId: true },
      });
      return {
        enabled: !off.some(({ deviceId }) => deviceId === ctx.deviceId),
        arrivalsOff: off,
      };
    }),
  set: groupMemberProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(setPlaceSharingSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return await ctx.db.$transaction(async (tx) => {
        await lockGroupMemberForWrite(tx, {
          groupId: input.groupId,
          groupLock: "FOR NO KEY UPDATE",
          userId,
        });
        await assertActiveDevices(tx, { deviceIds: [ctx.deviceId], userId });
        return await tx.placeSharing.upsert({
          where: { deviceId_groupId: { deviceId: ctx.deviceId, groupId: input.groupId } },
          create: {
            deviceId: ctx.deviceId,
            groupId: input.groupId,
            userId,
            enabled: input.enabled,
          },
          update: { enabled: input.enabled },
          select: { enabled: true },
        });
      });
    }),
} satisfies TRPCRouterRecord;
