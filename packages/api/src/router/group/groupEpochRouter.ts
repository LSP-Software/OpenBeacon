import type { TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

export const groupEpochRouter = {
  getLatest: groupMemberProcedure.query(async ({ ctx, input }) => {
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
