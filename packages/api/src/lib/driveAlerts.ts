import { Prisma, type PrismaClient, readDatabaseTime } from "@openbeacon/database";
import { encodeBase64, XCHACHA20_NONCE_LENGTH } from "@openbeacon/encryption";
import { effectiveNotificationSetting } from "@openbeacon/schemas";
import { HISTORY_RETENTION_MS, historyFirstHourSql } from "./historyShare.ts";
import { decodeAlertsCursor, encodeAlertsCursor } from "./placeTransitions.ts";

const HOUR_MS = 3_600_000;
const CATCH_UP_OVERLAP_MS = 60_000;
const CATCH_UP_LOOKBACK_MS = 30 * 60_000;
const CATCH_UP_LIMIT = 100;

export const driveAlertMutedSql = (muterUserIdSql: Prisma.Sql) => Prisma.sql`EXISTS (
  SELECT 1 FROM "DriveAlertMute" AS "mute"
  WHERE "mute"."groupId" = "drive"."groupId"
    AND "mute"."muterUserId" = ${muterUserIdSql}
    AND ("mute"."mutedUserId" IS NULL OR "mute"."mutedUserId" = "drive"."senderUserId")
)`;

export const readDriveAlertsSince = async ({
  cursor,
  db,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  userId: string;
}) => {
  const now = await readDatabaseTime(db);
  const caughtUp = encodeAlertsCursor({ createdAt: now, id: "" });
  if (cursor === null) return { alerts: [], cursor: caughtUp };
  const setting = await db.notificationSetting.findUnique({
    where: { userId_type: { userId, type: "DRIVES" } },
    select: { email: true, phone: true },
  });
  if (!effectiveNotificationSetting("DRIVES", setting ?? undefined).phone) {
    return { alerts: [], cursor: caughtUp };
  }
  const since = new Date(
    Math.max(
      decodeAlertsCursor(cursor).createdAt.getTime() - CATCH_UP_OVERLAP_MS,
      now.getTime() - CATCH_UP_LOOKBACK_MS,
    ),
  );
  const nowHour = Math.floor(now.getTime() / HOUR_MS);
  const windowHour = nowHour - HISTORY_RETENTION_MS / HOUR_MS;
  const rows = await db.$queryRaw<
    Array<{
      driveId: string;
      epochId: string;
      groupId: string;
      payload: Uint8Array;
      receivedAt: Date;
      senderDeviceId: string;
      senderUserId: string;
      startHour: number;
    }>
  >(Prisma.sql`
    SELECT "drive"."driveId", "drive"."epochId", "drive"."groupId", "drive"."payload",
      "drive"."receivedAt", "drive"."senderDeviceId", "drive"."senderUserId", "drive"."startHour"
    FROM "DriveCopy" AS "drive"
    JOIN "GroupMember" AS "viewer"
      ON "viewer"."groupId" = "drive"."groupId" AND "viewer"."userId" = ${userId}
    JOIN "GroupEpoch" AS "epoch" ON "epoch"."id" = "drive"."epochId"
    JOIN "GroupMember" AS "member"
      ON "member"."groupId" = "drive"."groupId" AND "member"."userId" = "drive"."senderUserId"
    JOIN "User" AS "account" ON "account"."id" = "drive"."senderUserId"
    JOIN "UserDevice" AS "device"
      ON "device"."id" = "drive"."senderDeviceId" AND "device"."userId" = "drive"."senderUserId"
    WHERE "drive"."senderUserId" <> ${userId}
      AND "drive"."receivedAt" >= ${since}
      AND "drive"."receivedAt" >= "viewer"."createdAt"
      AND "epoch"."epochNumber" >= "viewer"."joinedEpochNumber"
      AND "epoch"."epochNumber" >= "member"."joinedEpochNumber"
      AND "device"."revokedAt" IS NULL AND "device"."activatedAt" IS NOT NULL
      AND "drive"."startHour" >= ${windowHour}
      AND "drive"."startHour" >= ${historyFirstHourSql(nowHour, windowHour)}
      AND NOT ${driveAlertMutedSql(Prisma.sql`${userId}`)}
    ORDER BY "drive"."receivedAt", "drive"."groupId", "drive"."driveId"
    LIMIT ${CATCH_UP_LIMIT}
  `);
  const last = rows.at(-1);
  return {
    alerts: rows.map(({ payload, ...row }) => ({
      ...row,
      nonce: encodeBase64(payload.subarray(0, XCHACHA20_NONCE_LENGTH)),
      ciphertext: encodeBase64(payload.subarray(XCHACHA20_NONCE_LENGTH)),
    })),
    cursor:
      last && rows.length === CATCH_UP_LIMIT
        ? encodeAlertsCursor({
            createdAt: new Date(last.receivedAt.getTime() + CATCH_UP_OVERLAP_MS),
            id: "",
          })
        : caughtUp,
  };
};
