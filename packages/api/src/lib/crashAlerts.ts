import { Prisma, type PrismaClient, readDatabaseTime } from "@openbeacon/database";
import { decodeBase64, encodeBase64 } from "@openbeacon/encryption";
import type { crashAlertCopySchema } from "@openbeacon/schemas";
import { effectiveNotificationSetting } from "@openbeacon/schemas";
import {
  historyShareFirstHour,
  resolveHistoryShare,
  resolveLocationSharing,
} from "@openbeacon/shared";
import type z from "zod";
import { assertActiveDevices } from "./groupWriteChecks.ts";
import {
  effectiveHistoryShareSql,
  HISTORY_RETENTION_MS,
  historyFirstHourSql,
  LAST_LOCATION_CRASH_ALERT_MS,
} from "./historyShare.ts";
import { readAlertCatchUp } from "./alertCatchUp.ts";

const NONCE_LENGTH = 24;
const HOUR_MS = 3_600_000;

const crashAlertSelect = {
  id: true,
  groupId: true,
  messageId: true,
  epochId: true,
  senderUserId: true,
  senderDeviceId: true,
  payload: true,
  receivedAt: true,
  senderDevice: { select: { name: true } },
} as const;

const sharingSelect = {
  sharingPaused: true,
  sharingPausedUntil: true,
  sharingChangedAt: true,
  sharingRevision: true,
} as const;

const toCrashAlertView = (
  alert: Prisma.CrashAlertGetPayload<{ select: typeof crashAlertSelect }>,
) => ({
  id: alert.id,
  groupId: alert.groupId,
  messageId: alert.messageId,
  epochId: alert.epochId,
  senderUserId: alert.senderUserId,
  senderDeviceId: alert.senderDeviceId,
  deviceName: alert.senderDevice.name,
  nonce: encodeBase64(alert.payload.subarray(0, NONCE_LENGTH)),
  ciphertext: encodeBase64(alert.payload.subarray(NONCE_LENGTH)),
  receivedAt: alert.receivedAt,
});

const readSenderWindows = async (
  db: Pick<Prisma.TransactionClient, "groupMember">,
  groupIds: string[],
  now: Date,
) => {
  const members = await db.groupMember.findMany({
    where: { groupId: { in: groupIds } },
    select: {
      groupId: true,
      userId: true,
      historyShare: true,
      user: { select: { historyShare: true } },
    },
  });
  const nowHour = Math.floor(now.getTime() / HOUR_MS);
  return members.map((member) => {
    const share = resolveHistoryShare({
      account: member.user.historyShare,
      group: member.historyShare,
    });
    return {
      groupId: member.groupId,
      senderUserId: member.userId,
      share,
      from:
        share === "LAST_LOCATION"
          ? now.getTime() - LAST_LOCATION_CRASH_ALERT_MS
          : (historyShareFirstHour(share, nowHour) ?? 0) * HOUR_MS,
    };
  });
};

export const crashAlertWindowStartSql = (now: Date) =>
  Prisma.sql`(CASE WHEN ${effectiveHistoryShareSql} = 'LAST_LOCATION'
    THEN (${new Date(now.getTime() - LAST_LOCATION_CRASH_ALERT_MS).toISOString()}::timestamptz AT TIME ZONE 'UTC')
    ELSE (to_timestamp(${historyFirstHourSql(Math.floor(now.getTime() / HOUR_MS), 0)}::bigint * 3600) AT TIME ZONE 'UTC')
  END)`;

export const deleteCrashAlertsOutsideShare = async ({
  db,
  now,
}: {
  db: Pick<Prisma.TransactionClient, "$executeRaw">;
  now: Date;
}) => {
  const outsideShare = await db.$executeRaw(Prisma.sql`
    DELETE FROM "CrashAlert" AS "alert"
    USING "GroupMember" AS "member", "User" AS "account"
    WHERE "member"."groupId" = "alert"."groupId" AND "member"."userId" = "alert"."senderUserId"
      AND "account"."id" = "alert"."senderUserId"
      AND ${effectiveHistoryShareSql} <> 'MAXIMUM'
      AND "alert"."receivedAt" < ${crashAlertWindowStartSql(now)}
  `);
  const departed = await db.$executeRaw(Prisma.sql`
    DELETE FROM "CrashAlert" AS "alert"
    WHERE NOT EXISTS (
      SELECT 1 FROM "GroupMember" AS "member"
      WHERE "member"."groupId" = "alert"."groupId" AND "member"."userId" = "alert"."senderUserId"
    )
  `);
  return outsideShare + departed;
};

export const sendCrashAlerts = async ({
  copies,
  db,
  deviceId,
  userId,
}: {
  copies: z.infer<typeof crashAlertCopySchema>[];
  db: PrismaClient;
  deviceId: string;
  userId: string;
}) =>
  db.$transaction(async (tx) => {
    await assertActiveDevices(tx, { deviceIds: [deviceId], userId });
    const receivedAt = await readDatabaseTime(tx);
    const device = await tx.userDevice.findUniqueOrThrow({
      where: { id: deviceId },
      select: { ...sharingSelect, user: { select: sharingSelect } },
    });
    const groupIds = [...new Set(copies.map(({ groupId }) => groupId))];
    const [memberships, epochs, existing] = await Promise.all([
      tx.groupMember.findMany({
        where: { userId, groupId: { in: groupIds } },
        select: { groupId: true, joinedEpochNumber: true },
      }),
      tx.groupEpoch.findMany({
        where: { id: { in: copies.map(({ epochId }) => epochId) } },
        select: { id: true, groupId: true, epochNumber: true },
      }),
      tx.crashAlert.findMany({
        where: {
          OR: copies.map(({ groupId, messageId }) => ({ groupId, messageId })),
        },
        select: { groupId: true, messageId: true },
      }),
    ]);
    const paused = resolveLocationSharing(device.user, device, receivedAt.getTime()).paused;
    const key = ({ groupId, messageId }: { groupId: string; messageId: string }) =>
      `${groupId}|${messageId}`;
    const stored = new Set(existing.map(key));
    const result = {
      accepted: [] as { groupId: string; messageId: string }[],
      duplicates: [] as { groupId: string; messageId: string }[],
      discarded: [] as { groupId: string; messageId: string }[],
      expired: [] as { groupId: string; messageId: string }[],
      receivedAt,
    };
    const toInsert: Prisma.CrashAlertCreateManyInput[] = [];
    for (const copy of copies) {
      const id = { groupId: copy.groupId, messageId: copy.messageId };
      const member = memberships.find(({ groupId }) => groupId === copy.groupId);
      const epoch = epochs.find(({ id }) => id === copy.epochId);
      if (stored.has(key(copy))) {
        result.duplicates.push(id);
      } else if (paused || !member) {
        result.discarded.push(id);
      } else if (
        !epoch ||
        epoch.groupId !== copy.groupId ||
        epoch.epochNumber < member.joinedEpochNumber
      ) {
        result.expired.push(id);
      } else {
        toInsert.push({
          ...id,
          epochId: copy.epochId,
          senderDeviceId: deviceId,
          senderUserId: userId,
          payload: new Uint8Array([...decodeBase64(copy.nonce), ...decodeBase64(copy.ciphertext)]),
          receivedAt,
        });
      }
    }
    const inserted =
      toInsert.length > 0
        ? await tx.crashAlert.createManyAndReturn({
            data: toInsert,
            skipDuplicates: true,
            select: { id: true, groupId: true, messageId: true },
          })
        : [];
    const lastLocationGroupIds = (await readSenderWindows(tx, groupIds, receivedAt))
      .filter((window) => window.senderUserId === userId && window.share === "LAST_LOCATION")
      .map(({ groupId }) => groupId)
      .filter((groupId) => inserted.some((row) => row.groupId === groupId));
    if (lastLocationGroupIds.length > 0) {
      await tx.crashAlert.deleteMany({
        where: {
          groupId: { in: lastLocationGroupIds },
          senderDeviceId: deviceId,
          receivedAt: { lt: receivedAt },
        },
      });
    }
    const insertedKeys = new Set(inserted.map(key));
    for (const copy of toInsert) {
      const id = { groupId: copy.groupId, messageId: copy.messageId };
      (insertedKeys.has(key(id)) ? result.accepted : result.duplicates).push(id);
    }
    return { ...result, rowIds: inserted.map(({ id }) => id) };
  });

export const readCrashAlertsSince = async ({
  cursor,
  db,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  userId: string;
}) => {
  let notify = true;
  const { rows, cursor: next } = await readAlertCatchUp({
    cursor,
    db,
    lookbackMs: 24 * 3_600_000,
    read: async ({ now, since, limit }) => {
      const setting = await db.notificationSetting.findUnique({
        where: { userId_type: { userId, type: "CRASH_ALERTS" } },
        select: { email: true, phone: true },
      });
      notify = effectiveNotificationSetting("CRASH_ALERTS", setting ?? undefined).phone;
      const memberships = await db.groupMember.findMany({
        where: { userId },
        select: { groupId: true, createdAt: true },
      });
      if (memberships.length === 0) return [];
      const windows = await readSenderWindows(
        db,
        memberships.map(({ groupId }) => groupId),
        now,
      );
      return db.crashAlert.findMany({
        where: {
          OR: windows.flatMap((window) => {
            const membership = memberships.find(({ groupId }) => groupId === window.groupId);
            return membership && window.senderUserId !== userId
              ? [
                  {
                    groupId: window.groupId,
                    senderUserId: window.senderUserId,
                    receivedAt: {
                      gte: new Date(
                        Math.max(since.getTime(), membership.createdAt.getTime(), window.from),
                      ),
                    },
                  },
                ]
              : [];
          }),
        },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        take: limit,
        select: crashAlertSelect,
      });
    },
  });
  return { alerts: rows.map(toCrashAlertView), cursor: next, notify };
};

export const readGroupCrashAlerts = async ({
  db,
  groupId,
  memberSince,
}: {
  db: PrismaClient;
  groupId: string;
  memberSince: Date;
}) => {
  const now = await readDatabaseTime(db);
  const windows = await readSenderWindows(db, [groupId], now);
  const rows = await db.crashAlert.findMany({
    where: {
      groupId,
      OR: windows.map((window) => ({
        senderUserId: window.senderUserId,
        receivedAt: {
          gte: new Date(
            Math.max(now.getTime() - HISTORY_RETENTION_MS, memberSince.getTime(), window.from),
          ),
        },
      })),
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: crashAlertSelect,
  });
  return { alerts: rows.map(toCrashAlertView) };
};
