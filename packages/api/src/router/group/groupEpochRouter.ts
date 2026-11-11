import { Prisma } from "@openbeacon/database";
import { decodeBase64, isUsableX25519PublicKey } from "@openbeacon/encryption";
import { addHistoryWrapsSchema, groupEpochBundleSchema } from "@openbeacon/schemas";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import z from "zod";
import { getGroupJoinContext, persistGroupEpoch } from "../../lib/groupEpochs.ts";
import { activeGroupMemberProcedure } from "../../procedures/auth/group.ts";

const selectEpochKeyWraps = ({ deviceId, userId }: { deviceId: string; userId: string }) =>
  ({
    historyWraps: {
      orderBy: { historyKey: { version: "asc" } },
      select: {
        algorithm: true,
        createdAt: true,
        ephemeralPublicKey: true,
        historyKey: { select: { version: true } },
        senderPublicKey: true,
        wrappedKey: true,
      },
      where: { historyKey: { userId } },
    },
    id: true,
    recipientKeys: {
      select: {
        algorithm: true,
        createdAt: true,
        ephemeralPublicKey: true,
        recipientDeviceId: true,
        wrappedKey: true,
      },
      where: {
        recipientDeviceId: deviceId,
        recipientDevice: { revokedAt: null, activatedAt: { not: null }, userId },
      },
    },
    senderPublicKey: true,
  }) satisfies Prisma.GroupEpochSelect;

const toEpochKeyWraps = ({
  epoch: { historyWraps, id, recipientKeys, senderPublicKey },
  userId,
}: {
  epoch: Prisma.GroupEpochGetPayload<{ select: ReturnType<typeof selectEpochKeyWraps> }>;
  userId: string;
}) => {
  const deviceWrap = recipientKeys[0];
  return {
    deviceWrap: deviceWrap ? { ...deviceWrap, epochId: id, senderPublicKey } : null,
    historyWraps: historyWraps.map(({ historyKey, ...wrap }) => ({
      ...wrap,
      epochId: id,
      historyKeyVersion: historyKey.version,
      userId,
    })),
  };
};

export const groupEpochRouter = {
  rotationContext: activeGroupMemberProcedure.query(async ({ ctx, input }) => {
    if (!ctx.group?.epochRotationRequired) return null;
    return getGroupJoinContext({ db: ctx.db, groupId: input.groupId, userId: ctx.session.user.id });
  }),
  rotate: activeGroupMemberProcedure
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
          deviceId: ctx.deviceId,
          epoch: input.nextEpoch,
          groupId: input.groupId,
          userId: ctx.session.user.id,
        });
        return { rotated: true };
      });
    }),
  getLatest: activeGroupMemberProcedure
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
  listRecipientPublicKeys: activeGroupMemberProcedure.query(async ({ ctx, input }) => {
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
        activatedAt: { not: null },
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
  getEpochKeyWraps: activeGroupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(
      z.object({
        deviceId: z.string().min(1),
        epochId: z.string().min(1),
        groupId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const epoch = await ctx.db.groupEpoch.findFirst({
        select: selectEpochKeyWraps({ deviceId: input.deviceId, userId }),
        where: {
          epochNumber: { gte: ctx.groupMember.joinedEpochNumber },
          groupId: input.groupId,
          id: input.epochId,
        },
      });
      return epoch ? toEpochKeyWraps({ epoch, userId }) : { deviceWrap: null, historyWraps: [] };
    }),
  listEpochKeyWraps: activeGroupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(
      z.object({
        cursor: z.number().int().positive().nullish(),
        deviceId: z.string().min(1),
        groupId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const pageSize = input.limit;
      const epochs = await ctx.db.groupEpoch.findMany({
        orderBy: { epochNumber: "desc" },
        select: {
          ...selectEpochKeyWraps({ deviceId: input.deviceId, userId }),
          createdAt: true,
          epochNumber: true,
        },
        take: pageSize + 1,
        where: {
          epochNumber: {
            gte: ctx.groupMember.joinedEpochNumber,
            ...(input.cursor ? { lt: input.cursor } : {}),
          },
          groupId: input.groupId,
        },
      });
      const page = epochs.slice(0, pageSize);
      return {
        epochs: page.map((epoch) => ({
          ...toEpochKeyWraps({ epoch, userId }),
          createdAt: epoch.createdAt,
          epochId: epoch.id,
          epochNumber: epoch.epochNumber,
        })),
        nextCursor: epochs.length > pageSize ? (page.at(-1)?.epochNumber ?? null) : null,
      };
    }),
  listHistoryBackfill: activeGroupMemberProcedure
    .input(
      z.object({
        cursor: z.number().int().nonnegative().nullish(),
        deviceId: z.string().min(1),
        groupId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.deviceId !== ctx.deviceId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "That device ID isn't this phone." });
      }
      const userId = ctx.session.user.id;
      const device = await ctx.db.userDevice.findFirst({
        where: { id: input.deviceId, revokedAt: null, activatedAt: { not: null }, userId },
      });
      if (!device) {
        throw new TRPCError({ code: "FORBIDDEN", message: "The active device is not registered." });
      }
      const historyKey = await ctx.db.accountHistoryKey.findFirst({
        orderBy: { version: "desc" },
        select: { id: true, publicKey: true, version: true },
        where: { userId },
      });
      if (!historyKey) return { epochs: [], historyKey: null, nextCursor: null };
      const pageSize = 50;
      const epochs = await ctx.db.groupEpoch.findMany({
        orderBy: { epochNumber: "asc" },
        select: {
          epochNumber: true,
          id: true,
          recipientKeys: {
            select: {
              algorithm: true,
              createdAt: true,
              ephemeralPublicKey: true,
              recipientDeviceId: true,
              wrappedKey: true,
            },
            where: { recipientDeviceId: input.deviceId },
          },
          senderPublicKey: true,
        },
        take: pageSize + 1,
        where: {
          epochNumber: {
            gt: input.cursor ?? 0,
            gte: ctx.groupMember.joinedEpochNumber,
          },
          groupId: input.groupId,
          historyWraps: { none: { historyKeyId: historyKey.id } },
          recipientKeys: { some: { recipientDeviceId: input.deviceId } },
        },
      });
      const page = epochs.slice(0, pageSize);
      return {
        epochs: page.flatMap(({ epochNumber, id, recipientKeys, senderPublicKey }) =>
          recipientKeys.map((recipientKey) => ({
            deviceWrap: { ...recipientKey, epochId: id, senderPublicKey },
            epochId: id,
            epochNumber,
          })),
        ),
        historyKey: { ...historyKey, userId },
        nextCursor: epochs.length > pageSize ? (page.at(-1)?.epochNumber ?? null) : null,
      };
    }),
  addHistoryWraps: activeGroupMemberProcedure
    .input(addHistoryWrapsSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.deviceId !== ctx.deviceId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "That device ID isn't this phone." });
      }
      const userId = ctx.session.user.id;
      const epochIds = new Set(input.wraps.map(({ epochId }) => epochId));
      if (epochIds.size !== input.wraps.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Each epoch can only be wrapped once.",
        });
      }
      for (const wrap of input.wraps) {
        if (wrap.userId !== userId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "History wraps must target your own history key.",
          });
        }
        if (!isUsableX25519PublicKey(decodeBase64(wrap.ephemeralPublicKey))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid wrapped epoch key public key.",
          });
        }
      }
      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Group" WHERE id = ${input.groupId} FOR UPDATE`,
        );
        const member = await tx.groupMember.findUnique({
          select: { joinedEpochNumber: true },
          where: { userId_groupId: { groupId: input.groupId, userId } },
        });
        if (!member) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
        }
        const [currentHistoryKey] = await tx.$queryRaw<Array<{ id: string; version: number }>>(
          Prisma.sql`SELECT id, version FROM "AccountHistoryKey" WHERE "userId" = ${userId} ORDER BY version DESC LIMIT 1 FOR SHARE`,
        );
        if (!currentHistoryKey || currentHistoryKey.id !== input.historyKeyId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That history key is no longer your current history key.",
          });
        }
        if (input.wraps.some((wrap) => wrap.historyKeyVersion !== currentHistoryKey.version)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "History wraps must match the history key version.",
          });
        }
        const device = await tx.userDevice.findFirst({
          select: { publicKey: true },
          where: { id: input.deviceId, revokedAt: null, activatedAt: { not: null }, userId },
        });
        if (!device) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The active device is not registered.",
          });
        }
        if (input.wraps.some((wrap) => wrap.senderPublicKey !== device.publicKey)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "History wraps must be created by the active device.",
          });
        }
        const entitledEpochs = await tx.groupEpoch.count({
          where: {
            epochNumber: { gte: member.joinedEpochNumber },
            groupId: input.groupId,
            id: { in: [...epochIds] },
            recipientKeys: {
              some: { recipientDevice: { revokedAt: null, activatedAt: { not: null }, userId } },
            },
          },
        });
        if (entitledEpochs !== epochIds.size) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only add history wraps for epochs you have access to.",
          });
        }
        const created = await tx.groupEpochHistoryWrap.createMany({
          data: input.wraps.map((wrap) => ({
            algorithm: wrap.algorithm,
            ephemeralPublicKey: wrap.ephemeralPublicKey,
            groupEpochId: wrap.epochId,
            historyKeyId: currentHistoryKey.id,
            senderDeviceId: input.deviceId,
            senderPublicKey: wrap.senderPublicKey,
            wrappedKey: wrap.wrappedKey,
          })),
          skipDuplicates: true,
        });
        return { added: created.count };
      });
    }),
} satisfies TRPCRouterRecord;
