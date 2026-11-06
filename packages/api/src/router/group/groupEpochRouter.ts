import { Prisma } from "@openbeacon/database";
import { groupEpochBundleSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { getGroupJoinContext, persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

export const groupEpochRouter = {
  rotationContext: groupMemberProcedure.query(async ({ ctx, input }) => {
    if (!ctx.group?.epochRotationRequired) return null;
    return getGroupJoinContext({ db: ctx.db, groupId: input.groupId, userId: ctx.session.user.id });
  }),
  rotate: groupMemberProcedure
    .input(z.object({ groupId: z.string(), nextEpoch: groupEpochBundleSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const group = await tx.group.findUnique({ where: { id: input.groupId } });
        const member = await tx.groupMember.findUnique({
          where: { userId_groupId: { userId: ctx.session.user.id, groupId: input.groupId } },
        });
        if (!group || !member) throw new TRPCError({ code: "FORBIDDEN" });
        if (!group.epochRotationRequired) return { rotated: false };
        await persistGroupEpoch({
          db: tx,
          epoch: input.nextEpoch,
          groupId: input.groupId,
          userId: ctx.session.user.id,
        });
        return { rotated: true };
      });
    }),
  getLatest: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .query(async ({ ctx, input }) => {
      const latestEpoch = await ctx.db.groupEpoch.findFirst({
        orderBy: {
          epochNumber: "desc",
        },
        select: {
          createdAt: true,
          createdByDeviceId: true,
          epochNumber: true,
          groupId: true,
          id: true,
        },
        where: {
          groupId: input.groupId,
        },
      });

      if (!latestEpoch) {
        return null;
      }

      return {
        createdAt: latestEpoch.createdAt,
        createdByDeviceId: latestEpoch.createdByDeviceId,
        epochId: latestEpoch.id,
        epochNumber: latestEpoch.epochNumber,
        groupId: latestEpoch.groupId,
      };
    }),
  listRecipientPublicKeys: groupMemberProcedure.query(async ({ ctx, input }) => {
    return await ctx.db.userDevice.findMany({
      orderBy: {
        id: "asc",
      },
      select: {
        createdAt: true,
        id: true,
        publicKey: true,
        publicKeyAlgorithm: true,
        revokedAt: true,
        userId: true,
      },
      where: {
        revokedAt: null,
        user: {
          groupMembers: {
            some: {
              groupId: input.groupId,
            },
          },
        },
      },
    });
  }),
  getWrappedKey: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(
      z.object({
        deviceId: z.string().min(1),
        epochId: z.string().min(1),
        groupId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const wrappedKey = await ctx.db.groupEpochRecipientKey.findFirst({
        select: {
          algorithm: true,
          createdAt: true,
          ephemeralPublicKey: true,
          groupEpochId: true,
          nonce: true,
          recipientDeviceId: true,
          wrappedKey: true,
        },
        where: {
          groupEpochId: input.epochId,
          groupEpoch: {
            groupId: input.groupId,
          },
          recipientDeviceId: input.deviceId,
          recipientDevice: {
            userId: ctx.session.user.id,
          },
        },
      });

      if (!wrappedKey) {
        return null;
      }

      const { groupEpochId, ...wrappedEpochKey } = wrappedKey;

      return {
        ...wrappedEpochKey,
        epochId: groupEpochId,
      };
    }),
} satisfies TRPCRouterRecord;
