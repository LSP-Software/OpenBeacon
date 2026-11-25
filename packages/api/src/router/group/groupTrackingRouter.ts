import {
  groupTrackingDrivesSchema,
  groupTrackingGetLatestSchema,
  groupTrackingHistoryDaysSchema,
  groupTrackingHistoryRangeSchema,
  groupTrackingPollSchema,
  groupTrackingRequestUpdateSchema,
  groupTrackingUploadBatchSchema,
} from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { GroupEventType, readDatabaseTime } from "@openbeacon/database";
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
import {
  DRIVES_PER_DEVICE_GROUP_DAY,
  readGroupDrives,
  uploadDriveCopies,
} from "../../lib/drives.ts";
import { lockGroupMemberForWrite } from "../../lib/groupWriteChecks.ts";
import { readImageKeysNeedCatchUp } from "../../lib/imageKeys.ts";
import {
  readPlaceAlerts,
  readPlacesSummary,
  uploadPlaceTransitions,
} from "../../lib/placeTransitions.ts";
import { getWakeableSharingDeviceIds } from "../../lib/locationSharing.ts";
import { getTrackingKeyState } from "../../lib/trackingKeyState.ts";
import { ReasonError } from "../../lib/reasonError.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";
import { protectedProcedure } from "../../procedures/auth/runtime.ts";

const DEFAULT_POLL_LIMIT = 100;

export const groupTrackingRouter = {
  uploadBatch: groupMemberProcedure
    .meta({
      rateLimit: {
        limit: 1_000,
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
      const drives = input.drives ?? [];
      const driveAllowance = (deviceId: string, cost: number) => ({
        namespace: "groupTracking.driveAllowance",
        identifier: { type: "deviceGroup" as const, deviceId, groupId: input.groupId },
        limit: DRIVES_PER_DEVICE_GROUP_DAY,
        windowMs: 86_400_000,
        cost,
      });
      const driveCharged = new Map<string, number>();
      const driveAvailable = new Map<string, number>();
      const refundDriveAllowance = async (senderDeviceId: string, count: number) => {
        const cost = Math.min(count, driveCharged.get(senderDeviceId) ?? 0);
        if (cost <= 0) return;
        driveCharged.set(senderDeviceId, (driveCharged.get(senderDeviceId) ?? 0) - cost);
        const refunded = await tryCatch(
          ctx.cache.rateLimits.refund(driveAllowance(senderDeviceId, cost)),
        );
        if (refunded.error) {
          const code = errorCode(refunded.error);
          console.error(
            `[rate-limit] could not give back drive allowance${code ? ` (${code})` : ""}`,
          );
        }
      };
      for (const senderDeviceId of new Set(drives.map((drive) => drive.senderDeviceId))) {
        const cost = drives.filter((drive) => drive.senderDeviceId === senderDeviceId).length;
        const allowance = await ctx.cache.rateLimits.take(driveAllowance(senderDeviceId, cost), {
          whenUnavailable: "allow",
        });
        if (!allowance.unavailable) driveCharged.set(senderDeviceId, allowance.granted);
        driveAvailable.set(senderDeviceId, allowance.granted);
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
          const withDrives =
            drives.length === 0
              ? points
              : {
                  ...points,
                  drives: await uploadDriveCopies({
                    db: tx,
                    drives,
                    groupId: input.groupId,
                    joinedEpochNumber: member.joinedEpochNumber,
                    userId,
                    refundAllowance: async (senderDeviceId, count) => {
                      driveAvailable.set(
                        senderDeviceId,
                        (driveAvailable.get(senderDeviceId) ?? 0) + count,
                      );
                    },
                    takeAllowance: async (senderDeviceId, cost) => {
                      const granted = Math.min(cost, driveAvailable.get(senderDeviceId) ?? 0);
                      driveAvailable.set(
                        senderDeviceId,
                        (driveAvailable.get(senderDeviceId) ?? 0) - granted,
                      );
                      if (granted < cost) {
                        console.warn("[rate-limit] drive allowance reached", {
                          userId,
                          discarded: cost - granted,
                        });
                      }
                      return granted;
                    },
                  }),
                };
          if (placeTransitions.length === 0) return withDrives;
          return {
            ...withDrives,
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
        await Promise.all([
          ...[...charged].map(([senderDeviceId, cost]) => refundAllowance(senderDeviceId, cost)),
          ...[...driveCharged].map(([senderDeviceId, cost]) =>
            refundDriveAllowance(senderDeviceId, cost),
          ),
        ]);
        throw transaction.error;
      }
      await Promise.all([
        ...[...available].map(([senderDeviceId, unused]) =>
          refundAllowance(senderDeviceId, unused),
        ),
        ...[...driveAvailable].map(([senderDeviceId, unused]) =>
          refundDriveAllowance(senderDeviceId, unused),
        ),
      ]);
      const result = transaction.data;
      if ("placeTransitions" in result) {
        ctx.push?.placeTransitions({
          deviceId: ctx.deviceId,
          clientIds: result.placeTransitions.accepted,
        });
      }
      const asksToCatchUp =
        input.placeAlertsCursor !== undefined || input.noticesCursor !== undefined;
      const catchUpBudget = asksToCatchUp
        ? await ctx.cache.rateLimits.consume(
            {
              namespace: "groupTracking.uploadBatch.catchUp",
              identifier: { type: "userId", value: userId },
              limit: 120,
              windowMs: 60_000,
            },
            { whenUnavailable: "allow" },
          )
        : { allowed: false };
      if (asksToCatchUp && !catchUpBudget.allowed) {
        console.warn("[rate-limit] upload limit reached", {
          userId,
          limit: "catch-ups per minute",
        });
      }
      const placeAlertsCursor = catchUpBudget.allowed ? input.placeAlertsCursor : undefined;
      const noticesCursor = catchUpBudget.allowed ? input.noticesCursor : undefined;
      const [placeUpdates, imageKeysNeedCatchUp, notices] = await Promise.all([
        placeAlertsCursor === undefined
          ? null
          : tryCatch(
              Promise.all([
                readPlacesSummary({ db: ctx.db, userId }),
                readPlaceAlerts({ cursor: placeAlertsCursor, db: ctx.db, userId }),
              ]),
            ),
        placeAlertsCursor === undefined
          ? null
          : tryCatch(readImageKeysNeedCatchUp({ db: ctx.db, userId })),
        noticesCursor === undefined
          ? null
          : tryCatch(readGroupNotices({ cursor: noticesCursor, db: ctx.db, userId })),
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
      if (!catchUpBudget.allowed) return { ...result, ...catchUpFields };
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
  drives: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(groupTrackingDrivesSchema)
    .query(async ({ ctx, input }) => {
      return await readGroupDrives({
        cursor: input.cursor,
        db: ctx.db,
        fromHour: input.fromHour,
        groupId: input.groupId,
        joinedEpochNumber: ctx.groupMember.joinedEpochNumber,
        limit: input.limit ?? 200,
        toHour: input.toHour,
      });
    }),
  requestUpdate: protectedProcedure
    .meta({ rateLimit: { limit: 10, windowMs: 10 * 60_000 } })
    .input(groupTrackingRequestUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const push = ctx.push;
      if (!push?.enabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This server can't wake phones.",
        });
      }
      if (input.userId === ctx.session.user.id) return;
      const sharedGroups = await ctx.db.groupMember.findMany({
        where: {
          userId: input.userId,
          group: { groupMembers: { some: { userId: ctx.session.user.id } } },
        },
        select: { groupId: true },
      });
      if (sharedGroups.length === 0) return;
      const deviceIds = await getWakeableSharingDeviceIds(ctx.db, input.userId);
      if (deviceIds.length === 0) return;
      const perTarget = await ctx.cache.rateLimits.consume(
        {
          namespace: "groupTracking.requestUpdate.target",
          identifier: { type: "userId", value: input.userId },
          limit: 1,
          windowMs: 60_000,
        },
        { whenUnavailable: "allow" },
      );
      if (!perTarget.allowed) return;
      const requestedAt = await readDatabaseTime(ctx.db);
      await ctx.db.groupEvent.createMany({
        data: sharedGroups.map(({ groupId }) => ({
          groupId,
          type: GroupEventType.LOCATION_UPDATE_REQUESTED,
          actorUserId: ctx.session.user.id,
          subjectUserId: input.userId,
          createdAt: requestedAt,
        })),
      });
      push.requestLocation(deviceIds);
    }),
} satisfies TRPCRouterRecord;
