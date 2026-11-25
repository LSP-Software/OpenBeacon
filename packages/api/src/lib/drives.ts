import { Prisma, readDatabaseTime } from "@openbeacon/database";
import { encodeBase64, XCHACHA20_NONCE_LENGTH } from "@openbeacon/encryption";
import type { driveCopySchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import type { GroupWriteChecksDb } from "./groupWriteChecks.ts";
import { assertActiveDevices, findGroupEpochs } from "./groupWriteChecks.ts";
import {
  effectiveHistoryShareSql,
  HISTORY_RETENTION_MS,
  historyFirstHourSql,
  readUploaderHistoryWindow,
} from "./historyShare.ts";
import { ReasonError } from "./reasonError.ts";

export const DRIVES_PER_DEVICE_GROUP_DAY = 50;
const HOUR_MS = 3_600_000;
const HISTORY_RETENTION_HOURS = HISTORY_RETENTION_MS / HOUR_MS;

type DrivesDb = GroupWriteChecksDb & Pick<Prisma.TransactionClient, "$queryRaw">;

export const uploadDriveCopies = async ({
  db,
  drives,
  groupId,
  joinedEpochNumber,
  refundAllowance,
  takeAllowance,
  userId,
}: {
  db: DrivesDb;
  drives: z.infer<typeof driveCopySchema>[];
  groupId: string;
  joinedEpochNumber: number;
  refundAllowance: (senderDeviceId: string, count: number) => Promise<void>;
  takeAllowance: (senderDeviceId: string, cost: number) => Promise<number>;
  userId: string;
}) => {
  await assertActiveDevices(db, {
    deviceIds: [...new Set(drives.map((drive) => drive.senderDeviceId))],
    userId,
  });
  const foundEpochIds = await findGroupEpochs(db, {
    epochIds: [...new Set(drives.map((drive) => drive.epochId))],
    groupId,
    joinedEpochNumber,
  });
  const expired = drives.filter((drive) => !foundEpochIds.has(drive.epochId));
  const { firstHour, nowHour } = await readUploaderHistoryWindow(db, { groupId, userId });
  const outsideWindow = drives.filter(
    (drive) =>
      foundEpochIds.has(drive.epochId) &&
      (drive.startHour < Math.max(firstHour, nowHour - HISTORY_RETENTION_HOURS) ||
        drive.startHour > nowHour + 1),
  );
  const inWindow = drives.filter(
    (drive) => foundEpochIds.has(drive.epochId) && !outsideWindow.includes(drive),
  );
  const stored =
    inWindow.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db.$queryRaw<Array<{ driveId: string }>>(Prisma.sql`
              SELECT "driveId" FROM "DriveCopy"
              WHERE "groupId" = ${groupId} AND "driveId" = ANY(${inWindow.map(({ driveId }) => driveId)}::text[])
            `)
          ).map(({ driveId }) => driveId),
        );
  const fresh = inWindow.filter((drive) => !stored.has(drive.driveId));
  const charged: typeof fresh = [];
  const overAllowance: typeof fresh = [];
  for (const senderDeviceId of new Set(fresh.map((drive) => drive.senderDeviceId))) {
    const deviceDrives = fresh.filter((drive) => drive.senderDeviceId === senderDeviceId);
    const granted = await takeAllowance(senderDeviceId, deviceDrives.length);
    charged.push(...deviceDrives.slice(0, granted));
    overAllowance.push(...deviceDrives.slice(granted));
  }
  const receivedAt = await readDatabaseTime(db);
  const inserted =
    charged.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db.$queryRaw<Array<{ driveId: string }>>(Prisma.sql`
              INSERT INTO "DriveCopy" ("groupId", "driveId", "epochId", "senderDeviceId", "senderUserId", "startHour", "payload", "receivedAt")
              SELECT ${groupId}, "driveId", "epochId", "senderDeviceId", ${userId}, "startHour",
                decode("nonce", 'base64') || decode("ciphertext", 'base64'), ${receivedAt}
              FROM unnest(
                ${charged.map(({ driveId }) => driveId)}::text[],
                ${charged.map(({ epochId }) => epochId)}::text[],
                ${charged.map(({ senderDeviceId }) => senderDeviceId)}::text[],
                ${charged.map(({ startHour }) => startHour)}::int4[],
                ${charged.map(({ nonce }) => nonce)}::text[],
                ${charged.map(({ ciphertext }) => ciphertext)}::text[]
              ) AS "row"("driveId", "epochId", "senderDeviceId", "startHour", "nonce", "ciphertext")
              ORDER BY "driveId"
              ON CONFLICT ("groupId", "driveId") DO NOTHING
              RETURNING "driveId"
            `)
          ).map(({ driveId }) => driveId),
        );
  const raced = charged.filter((drive) => !inserted.has(drive.driveId));
  for (const senderDeviceId of new Set(raced.map((drive) => drive.senderDeviceId))) {
    await refundAllowance(
      senderDeviceId,
      raced.filter((drive) => drive.senderDeviceId === senderDeviceId).length,
    );
  }
  return {
    accepted: charged.filter((drive) => inserted.has(drive.driveId)).map(({ driveId }) => driveId),
    discarded: [...outsideWindow, ...overAllowance].map(({ driveId }) => driveId),
    duplicates: [...inWindow.filter((drive) => stored.has(drive.driveId)), ...raced].map(
      ({ driveId }) => driveId,
    ),
    expired: expired.map(({ driveId }) => driveId),
  };
};

export const readGroupDrives = async ({
  cursor,
  db,
  fromHour,
  groupId,
  joinedEpochNumber,
  limit,
  toHour,
}: {
  cursor: { driveId: string; startHour: number } | undefined;
  db: Pick<Prisma.TransactionClient, "$queryRaw">;
  fromHour: number;
  groupId: string;
  joinedEpochNumber: number;
  limit: number;
  toHour: number;
}) => {
  const nowHour = Math.floor((await readDatabaseTime(db)).getTime() / HOUR_MS);
  const windowHour = nowHour - HISTORY_RETENTION_HOURS;
  const rows = await db.$queryRaw<
    Array<{
      driveId: string;
      epochId: string;
      epochNumber: number;
      payload: Uint8Array;
      receivedAt: Date;
      replacedAt: Date | null;
      senderDeviceId: string;
      senderUserId: string;
      startHour: number;
    }>
  >(Prisma.sql`
    SELECT "drive"."driveId", "drive"."epochId", "epoch"."epochNumber", "drive"."payload",
      "drive"."receivedAt", "drive"."replacedAt", "drive"."senderDeviceId", "drive"."senderUserId",
      "drive"."startHour"
    FROM "DriveCopy" AS "drive"
    JOIN "GroupEpoch" AS "epoch" ON "epoch"."id" = "drive"."epochId"
    JOIN "GroupMember" AS "member"
      ON "member"."groupId" = "drive"."groupId" AND "member"."userId" = "drive"."senderUserId"
    JOIN "User" AS "account" ON "account"."id" = "drive"."senderUserId"
    JOIN "UserDevice" AS "device"
      ON "device"."id" = "drive"."senderDeviceId" AND "device"."userId" = "drive"."senderUserId"
    WHERE "drive"."groupId" = ${groupId}
      AND "epoch"."epochNumber" >= ${joinedEpochNumber}
      AND "epoch"."epochNumber" >= "member"."joinedEpochNumber"
      AND "device"."revokedAt" IS NULL AND "device"."activatedAt" IS NOT NULL
      AND "drive"."startHour" >= ${fromHour}
      AND "drive"."startHour" < ${toHour}
      AND "drive"."startHour" >= ${windowHour}
      AND "drive"."startHour" >= ${historyFirstHourSql(nowHour, windowHour)}
      ${
        cursor
          ? Prisma.sql`AND ("drive"."startHour", "drive"."driveId") > (${cursor.startHour}::int4, ${cursor.driveId})`
          : Prisma.empty
      }
    ORDER BY "drive"."startHour", "drive"."driveId"
    LIMIT ${limit}
  `);
  const last = rows.at(-1);
  return {
    drives: rows.map(({ payload, ...row }) => ({
      ...row,
      ciphertext: encodeBase64(payload.subarray(XCHACHA20_NONCE_LENGTH)),
      nonce: encodeBase64(payload.subarray(0, XCHACHA20_NONCE_LENGTH)),
    })),
    cursor: last ? { driveId: last.driveId, startHour: last.startHour } : null,
    hasMore: rows.length === limit,
  };
};

export const replaceDriveCopies = async ({
  copies,
  db,
  driveId,
  userId,
}: {
  copies: Array<{ ciphertext: string; groupId: string; nonce: string }>;
  db: Prisma.TransactionClient;
  driveId: string;
  userId: string;
}) => {
  const stored = await db.$queryRaw<Array<{ groupId: string }>>(Prisma.sql`
    SELECT "groupId" FROM "DriveCopy"
    WHERE "driveId" = ${driveId} AND "senderUserId" = ${userId}
    ORDER BY "groupId"
    FOR UPDATE
  `);
  if (stored.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "This drive no longer exists." });
  }
  const storedGroupIds = stored.map(({ groupId }) => groupId);
  if (
    copies.length !== storedGroupIds.length ||
    copies.some(({ groupId }) => !storedGroupIds.includes(groupId))
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Every group's copy of this drive must be replaced together.",
      cause: new ReasonError("DRIVE_COPIES_CHANGED"),
    });
  }
  const replacedAt = await readDatabaseTime(db);
  await db.$executeRaw(Prisma.sql`
    UPDATE "DriveCopy" AS "drive"
    SET "payload" = decode("row"."nonce", 'base64') || decode("row"."ciphertext", 'base64'),
      "replacedAt" = ${replacedAt}
    FROM unnest(
      ${copies.map(({ groupId }) => groupId)}::text[],
      ${copies.map(({ nonce }) => nonce)}::text[],
      ${copies.map(({ ciphertext }) => ciphertext)}::text[]
    ) AS "row"("groupId", "nonce", "ciphertext")
    WHERE "drive"."groupId" = "row"."groupId" AND "drive"."driveId" = ${driveId}
      AND "drive"."senderUserId" = ${userId}
  `);
  return { replaced: storedGroupIds };
};

export const deleteExpiredDriveCopies = async ({
  db,
  nowHour,
}: {
  db: Pick<Prisma.TransactionClient, "$executeRaw">;
  nowHour: number;
}) => {
  const expired = await db.$executeRaw(Prisma.sql`
    DELETE FROM "DriveCopy" WHERE "startHour" < ${nowHour - HISTORY_RETENTION_HOURS}
  `);
  const outsideShare = await db.$executeRaw(Prisma.sql`
    DELETE FROM "DriveCopy" AS "drive"
    USING "GroupMember" AS "member", "User" AS "account"
    WHERE "member"."groupId" = "drive"."groupId" AND "member"."userId" = "drive"."senderUserId"
      AND "account"."id" = "drive"."senderUserId"
      AND ${effectiveHistoryShareSql} <> 'MAXIMUM'
      AND "drive"."startHour" < ${historyFirstHourSql(nowHour, 0)}
  `);
  const departed = await db.$executeRaw(Prisma.sql`
    DELETE FROM "DriveCopy" AS "drive"
    WHERE NOT EXISTS (
      SELECT 1 FROM "GroupMember" AS "member"
      WHERE "member"."groupId" = "drive"."groupId" AND "member"."userId" = "drive"."senderUserId"
    )
  `);
  return expired + outsideShare + departed;
};
