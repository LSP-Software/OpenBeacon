import {
  groupTrackingGetLatestSchema,
  groupTrackingHistoryDaysSchema,
  groupTrackingHistoryRangeSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
} from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import {
  getLatestGroupTrackingPoints,
  HISTORY_POINTS_PER_DEVICE_DAY,
  pollGroupTrackingPoints,
  readGroupTrackingHistoryDays,
  readGroupTrackingHistoryRange,
  uploadGroupTrackingBatch,
} from "../../lib/groupTracking.ts";
import { readGroupNotices } from "../../lib/accountNotices.ts";
import { lockGroupMemberForWrite } from "../../lib/groupWriteChecks.ts";
import { readImageKeysNeedCatchUp } from "../../lib/imageKeys.ts";
import {
  readPlaceAlerts,
  readPlacesSummary,
  uploadPlaceTransitions,
} from "../../lib/placeTransitions.ts";
import { getTrackingKeyState } from "../../lib/trackingKeyState.ts";
import { ReasonError } from "../../lib/reasonError.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

const DEFAULT_POLL_LIMIT = 100;

export const groupTrackingRouter = {
  uploadBatch: groupMemberProcedure
    .meta({
      rateLimit: {
        limit: 240,
        windowMs: 60_000,
      },
    })
    .input(groupTrackingUploadBatchSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const uploadLimitReached = (limit: string) => {
        console.warn("[rate-limit] upload limit reached", { userId, limit });
        return new TRPCError({
          code: "TOO_MANY_REQUESTS",
          cause: new ReasonError("UPLOAD_LIMIT_REACHED"),
        });
      };
      if (input.points.length > 0) {
        const perMinute = await ctx.cache.rateLimits.consume(
          {
            namespace: "groupTracking.uploadBatch.points",
            identifier: { type: "userId", value: userId },
            limit: 2_000,
            windowMs: 60_000,
            cost: input.points.length,
          },
          { whenUnavailable: "allow" },
        );
        if (!perMinute.allowed) throw uploadLimitReached("points per minute");
      }
      const placeTransitions = input.placeTransitions ?? [];
      const transitionBudget =
        placeTransitions.length > 0
          ? await ctx.cache.rateLimits.consume(
              {
                namespace: "groupTracking.uploadBatch.placeTransitions",
                identifier: { type: "userId", value: userId },
                limit: 240,
                windowMs: 3_600_000,
                cost: placeTransitions.length,
              },
              { whenUnavailable: "allow" },
            )
          : { allowed: true };
      if (!transitionBudget.allowed) {
        console.warn("[rate-limit] upload limit reached", {
          userId,
          limit: "place transitions per hour",
        });
      }
      const historyAllowance = (deviceId: string, cost: number) => ({
        namespace: "groupTracking.historyAllowance",
        identifier: { type: "deviceGroup" as const, deviceId, groupId: input.groupId },
        limit: HISTORY_POINTS_PER_DEVICE_DAY,
        windowMs: 86_400_000,
        cost,
      });
      const charged = new Map<string, number>();
      const available = new Map<string, number>();
      const refundAllowance = async (senderDeviceId: string, count: number) => {
        const cost = Math.min(count, charged.get(senderDeviceId) ?? 0);
        if (cost <= 0) return;
        charged.set(senderDeviceId, (charged.get(senderDeviceId) ?? 0) - cost);
        const refunded = await tryCatch(
          ctx.cache.rateLimits.refund(historyAllowance(senderDeviceId, cost)),
        );
        if (refunded.error) {
          const code = errorCode(refunded.error);
          console.error(
            `[rate-limit] could not give back history allowance${code ? ` (${code})` : ""}`,
          );
        }
      };
      const historyCosts = new Map<string, number>();
      for (const point of input.points) {
        if (point.role === "LIVE") continue;
        historyCosts.set(point.senderDeviceId, (historyCosts.get(point.senderDeviceId) ?? 0) + 1);
      }
      for (const [senderDeviceId, cost] of historyCosts) {
        const allowance = await ctx.cache.rateLimits.take(historyAllowance(senderDeviceId, cost), {
          whenUnavailable: "allow",
        });
        if (!allowance.unavailable) charged.set(senderDeviceId, allowance.granted);
        available.set(senderDeviceId, allowance.granted);
      }
      const transaction = await tryCatch(
        ctx.db.$transaction(async (tx) => {
          const member = await lockGroupMemberForWrite(tx, {
            groupId: input.groupId,
            groupLock: "FOR SHARE",
            userId,
          });
          const points =
            input.points.length > 0
              ? await uploadGroupTrackingBatch({
                  db: tx,
                  groupId: input.groupId,
                  joinedEpochNumber: member.joinedEpochNumber,
                  points: input.points,
                  userId,
                  refundAllowance: async (senderDeviceId, count) => {
                    available.set(senderDeviceId, (available.get(senderDeviceId) ?? 0) + count);
                  },
                  takeAllowance: async (senderDeviceId, cost) => {
                    const granted = Math.min(cost, available.get(senderDeviceId) ?? 0);
                    available.set(senderDeviceId, (available.get(senderDeviceId) ?? 0) - granted);
                    if (granted < cost) {
                      console.warn("[rate-limit] history allowance reached", {
                        userId,
                        discarded: cost - granted,
                      });
                    }
                    return granted;
                  },
                })
              : { accepted: [], discarded: [], duplicates: [], expired: [] };
          if (placeTransitions.length === 0) return points;
          return {
            ...points,
            placeTransitions: transitionBudget.allowed
              ? await uploadPlaceTransitions({
                  db: tx,
                  deviceId: ctx.deviceId,
                  groupId: input.groupId,
                  memberSince: member.createdAt,
                  transitions: placeTransitions,
                  userId,
                })
              : {
                  accepted: [],
                  duplicates: [],
                  discarded: placeTransitions.map(({ clientId }) => clientId),
                },
          };
        }),
      );
      if (transaction.error) {
        await Promise.all(
          [...charged].map(([senderDeviceId, cost]) => refundAllowance(senderDeviceId, cost)),
        );
        throw transaction.error;
      }
      await Promise.all(
        [...available].map(([senderDeviceId, unused]) => refundAllowance(senderDeviceId, unused)),
      );
      const result = transaction.data;
      if ("placeTransitions" in result) {
        ctx.push?.placeTransitions({
          deviceId: ctx.deviceId,
          clientIds: result.placeTransitions.accepted,
        });
      }
      const [placeUpdates, imageKeysNeedCatchUp, notices] = await Promise.all([
        input.placeAlertsCursor === undefined
          ? null
          : tryCatch(
              Promise.all([
                readPlacesSummary({ db: ctx.db, userId }),
                readPlaceAlerts({ cursor: input.placeAlertsCursor, db: ctx.db, userId }),
              ]),
            ),
        input.placeAlertsCursor === undefined
          ? null
          : tryCatch(readImageKeysNeedCatchUp({ db: ctx.db, userId })),
        input.noticesCursor === undefined
          ? null
          : tryCatch(readGroupNotices({ cursor: input.noticesCursor, db: ctx.db, userId })),
      ]);
      const catchUpFields = {
        ...(notices && !notices.error ? { notices: notices.data } : {}),
        ...(placeUpdates && !placeUpdates.error
          ? { places: placeUpdates.data[0], placeAlerts: placeUpdates.data[1] }
          : {}),
        ...(imageKeysNeedCatchUp && !imageKeysNeedCatchUp.error
          ? { imageKeysNeedCatchUp: imageKeysNeedCatchUp.data }
          : {}),
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const keyState = await tryCatch(
        Promise.race([
          getTrackingKeyState({
            db: ctx.db,
            deviceId: ctx.deviceId,
            userId: ctx.session.user.id,
          }),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 2_000);
          }),
        ]),
      );
      clearTimeout(timer);
      if (keyState.error || keyState.data === null) return { ...result, ...catchUpFields };
      return { ...result, ...catchUpFields, keyState: keyState.data };
    }),
  poll: groupMemberProcedure
    .meta({ rateLimit: { limit: 480, windowMs: 60_000 } })
    .input(groupTrackingPollSchema)
    .query(async ({ ctx, input }) => {
      return await pollGroupTrackingPoints({
        cursor: input.cursor,
        db: ctx.db,
        groupId: input.groupId,
        joinedEpochNumber: ctx.groupMember.joinedEpochNumber,
        limit: input.limit ?? DEFAULT_POLL_LIMIT,
      });
    }),
  getLatest: groupMemberProcedure
    .meta({ rateLimit: { limit: 480, windowMs: 60_000 } })
    .input(groupTrackingGetLatestSchema)
    .query(async ({ ctx, input }) => {
      return await getLatestGroupTrackingPoints({
        db: ctx.db,
        groupId: input.groupId,
        joinedEpochNumber: ctx.groupMember.joinedEpochNumber,
      });
    }),
  historyDays: groupMemberProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(groupTrackingHistoryDaysSchema)
    .query(async ({ ctx, input }) => {
      return await readGroupTrackingHistoryDays({
        db: ctx.db,
        groupId: input.groupId,
        joinedEpochNumber: ctx.groupMember.joinedEpochNumber,
      });
    }),
  historyRange: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(groupTrackingHistoryRangeSchema)
    .query(async ({ ctx, input }) => {
      return await readGroupTrackingHistoryRange({
        cursor: input.cursor,
        db: ctx.db,
        fromHour: input.fromHour,
        groupId: input.groupId,
        joinedEpochNumber: ctx.groupMember.joinedEpochNumber,
        limit: input.limit ?? 1_000,
        toHour: input.toHour,
      });
    }),
} satisfies TRPCRouterRecord;
