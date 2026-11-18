import { Prisma, readDatabaseTime } from "@openbeacon/database";
import { decodeBase64, encodeBase64, XCHACHA20_NONCE_LENGTH } from "@openbeacon/encryption";
import type { groupTrackingPointSchema, TRACKING_POINT_ROLES } from "@openbeacon/schemas";
import type { GroupDeviceSharingState } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import type { GroupWriteChecksDb } from "./groupWriteChecks.ts";
import { assertActiveDevices, findGroupEpochs } from "./groupWriteChecks.ts";
import { getGroupSharingStates } from "./locationSharing.ts";
import { HISTORY_RETENTION_MS } from "./placeTransitions.ts";

type GroupTrackingDb = GroupWriteChecksDb & {
  userDevice: {
    updateMany: (args: {
      data: { lastLocationAt: Date };
      where: { id: { in: string[] }; userId: string };
    }) => Promise<{ count: number }>;
  };
};

export const parseClientPointId = (clientPointId: string) => {
  const separator = clientPointId.lastIndexOf(":");
  const bytes = decodeBase64(clientPointId.slice(separator + 1));
  return {
    pointId: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0),
    revisionPrefix: clientPointId.slice(0, separator + 1),
  };
};

type TrackingStreamKey = { epochId: string; revisionPrefix: string; senderDeviceId: string };

export const uploadGroupTrackingBatch = async ({
  db,
  groupId,
  memberSince,
  points,
  refundAllowance,
  takeAllowance,
  userId,
}: {
  db: GroupTrackingDb;
  groupId: string;
  memberSince?: Date;
  points: z.infer<typeof groupTrackingPointSchema>[];
  refundAllowance: (senderDeviceId: string, count: number) => Promise<void>;
  takeAllowance: (senderDeviceId: string, cost: number) => Promise<number>;
  userId: string;
}) => {
  const clientPointIds = points.map((point) => point.clientPointId);
  if (new Set(clientPointIds).size !== clientPointIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Duplicate clientPointId values in upload batch.",
    });
  }

  await assertActiveDevices(db, {
    deviceIds: [...new Set(points.map((point) => point.senderDeviceId))],
    userId,
  });
  const foundEpochIds = await findGroupEpochs(db, {
    epochIds: [...new Set(points.map((point) => point.epochId))],
    groupId,
    ...(memberSince ? { memberSince } : {}),
  });
  const sharing = await getGroupSharingStates(db, groupId);

  const expired = points.filter((point) => !foundEpochIds.has(point.epochId));
  const current = points
    .filter((point) => foundEpochIds.has(point.epochId))
    .map((point) => ({ ...point, ...parseClientPointId(point.clientPointId) }));
  const discarded = current.filter((point) => {
    const state = sharing.find(
      (device) => device.deviceId === point.senderDeviceId && device.userId === userId,
    );
    return !state || state.paused || point.revisionPrefix !== state.revisionPrefix;
  });
  const kept = current.filter((point) => !discarded.includes(point));

  const streamKey = (point: TrackingStreamKey) =>
    JSON.stringify([point.epochId, point.senderDeviceId, point.revisionPrefix]);
  const streamRows = (streams: TrackingStreamKey[]) =>
    Prisma.sql`unnest(
      ${streams.map(({ epochId }) => epochId)}::text[],
      ${streams.map(({ senderDeviceId }) => senderDeviceId)}::text[],
      ${streams.map(({ revisionPrefix }) => revisionPrefix)}::text[]
    ) AS "row"("epochId", "senderDeviceId", "revisionPrefix")`;
  const lockStreams = async (streams: TrackingStreamKey[]) =>
    streams.length === 0
      ? []
      : db.$queryRaw<Array<TrackingStreamKey & { id: string }>>(Prisma.sql`
          SELECT id::text AS id, "epochId", "senderDeviceId", "revisionPrefix" FROM "TrackingStream"
          WHERE "groupId" = ${groupId}
            AND ("epochId", "senderDeviceId", "revisionPrefix") IN (
              SELECT "epochId", "senderDeviceId", "revisionPrefix" FROM ${streamRows(streams)}
            )
          ORDER BY id
          FOR SHARE
        `);
  const wantedStreams = [...new Map(kept.map((point) => [streamKey(point), point])).values()];
  const foundStreams = await lockStreams(wantedStreams);
  const foundKeys = new Set(foundStreams.map(streamKey));
  const missingStreams = wantedStreams.filter((stream) => !foundKeys.has(streamKey(stream)));
  if (missingStreams.length > 0) {
    await db.$queryRaw(Prisma.sql`
      INSERT INTO "TrackingStream" ("groupId", "epochId", "senderDeviceId", "senderUserId", "revisionPrefix", "createdAt")
      SELECT ${groupId}, "epochId", "senderDeviceId", ${userId}, "revisionPrefix", (now() AT TIME ZONE 'UTC')
      FROM ${streamRows(missingStreams)}
      ORDER BY "epochId", "senderDeviceId", "revisionPrefix"
      ON CONFLICT ("groupId", "epochId", "senderDeviceId", "revisionPrefix") DO NOTHING
    `);
  }
  const streamIds = new Map(
    [...foundStreams, ...(await lockStreams(missingStreams))].map((stream) => [
      streamKey(stream),
      stream.id,
    ]),
  );
  const withStreams = kept.map((point) => {
    const streamId = streamIds.get(streamKey(point));
    if (!streamId) throw new Error("Tracking stream was not created.");
    return { ...point, streamId };
  });
  const pointKey = (point: { pointId: bigint | string; streamId: string }) =>
    `${point.streamId}:${point.pointId}`;
  const history = withStreams.filter((point) => point.role !== "LIVE");
  const alreadyStored =
    history.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db.$queryRaw<Array<{ streamId: string; pointId: string }>>(Prisma.sql`
              SELECT "point"."streamId"::text AS "streamId", "point"."pointId"::text AS "pointId"
              FROM "TrackingPoint" AS "point"
              JOIN unnest(
                ${history.map(({ streamId }) => streamId)}::text[],
                ${history.map(({ pointId }) => pointId.toString())}::text[]
              ) AS "row"("streamId", "pointId")
                ON "point"."streamId" = "row"."streamId"::bigint
                AND "point"."pointId" = "row"."pointId"::bigint
            `)
          ).map(pointKey),
        );
  const newRows = history.filter((point) => !alreadyStored.has(pointKey(point)));
  const charged: typeof newRows = [];
  const overAllowance: typeof newRows = [];
  for (const senderDeviceId of new Set(newRows.map((point) => point.senderDeviceId))) {
    const deviceRows = newRows.filter((point) => point.senderDeviceId === senderDeviceId);
    const granted = await takeAllowance(senderDeviceId, deviceRows.length);
    charged.push(...deviceRows.slice(0, granted));
    overAllowance.push(...deviceRows.slice(granted));
  }
  const allowed = withStreams.filter((point) => !overAllowance.includes(point));
  const insertOrder = [...allowed].sort((first, second) =>
    first.streamId === second.streamId
      ? Number(first.pointId > second.pointId) - Number(first.pointId < second.pointId)
      : Number(BigInt(first.streamId) > BigInt(second.streamId)) -
        Number(BigInt(first.streamId) < BigInt(second.streamId)),
  );

  const storePoints = async (role: Exclude<(typeof TRACKING_POINT_ROLES)[number], "LIVE">) => {
    const rows = insertOrder.filter((point) => point.role === role);
    if (rows.length === 0) return [];
    return db.$queryRaw<Array<{ inserted: boolean; pointId: string; streamId: string }>>(Prisma.sql`
      INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedAt", "payload")
      SELECT "streamId"::bigint, "pointId"::bigint, (now() AT TIME ZONE 'UTC'),
        decode("nonce", 'base64') || decode("ciphertext", 'base64')
      FROM unnest(
        ${rows.map(({ streamId }) => streamId)}::text[],
        ${rows.map(({ pointId }) => pointId.toString())}::text[],
        ${rows.map(({ nonce }) => nonce)}::text[],
        ${rows.map(({ ciphertext }) => ciphertext)}::text[]
      ) AS "row"("streamId", "pointId", "nonce", "ciphertext")
      ON CONFLICT ("streamId", "pointId") ${
        role === "STAY"
          ? Prisma.sql`DO UPDATE SET "payload" = EXCLUDED."payload"`
          : Prisma.sql`DO NOTHING`
      }
      RETURNING "streamId"::text AS "streamId", "pointId"::text AS "pointId", (xmax = 0) AS "inserted"
    `);
  };
  const inserted = new Set(
    [...(await storePoints("POINT")), ...(await storePoints("STAY"))]
      .filter((row) => row.inserted)
      .map(pointKey),
  );
  const unused = charged.filter((point) => !inserted.has(pointKey(point)));
  for (const senderDeviceId of new Set(unused.map((point) => point.senderDeviceId))) {
    await refundAllowance(
      senderDeviceId,
      unused.filter((point) => point.senderDeviceId === senderDeviceId).length,
    );
  }
  const accepted = allowed.filter(
    (point) => point.role !== "POINT" || inserted.has(pointKey(point)),
  );

  const latestByDeviceEpoch = new Map(
    withStreams
      .filter(
        (point) =>
          point.role !== "STAY" && (accepted.includes(point) || overAllowance.includes(point)),
      )
      .map((point) => [`${point.senderDeviceId}:${point.epochId}`, point]),
  );
  for (const latest of latestByDeviceEpoch.values()) {
    await db.$queryRaw(Prisma.sql`
      INSERT INTO "TrackingLatestPoint" ("groupId", "senderDeviceId", "streamId", "payload", "updatedAt")
      VALUES (${groupId}, ${latest.senderDeviceId}, ${latest.streamId}::bigint,
        decode(${latest.nonce}, 'base64') || decode(${latest.ciphertext}, 'base64'),
        (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("groupId", "senderDeviceId") DO UPDATE SET
        "streamId" = EXCLUDED."streamId", "payload" = EXCLUDED."payload", "updatedAt" = EXCLUDED."updatedAt"
      WHERE (
        SELECT "epoch"."epochNumber" FROM "TrackingStream" AS "stream"
        JOIN "GroupEpoch" AS "epoch" ON "epoch"."id" = "stream"."epochId"
        WHERE "stream"."id" = EXCLUDED."streamId"
      ) >= (
        SELECT "epoch"."epochNumber" FROM "TrackingStream" AS "stream"
        JOIN "GroupEpoch" AS "epoch" ON "epoch"."id" = "stream"."epochId"
        WHERE "stream"."id" = "TrackingLatestPoint"."streamId"
      )
    `);
  }

  if (accepted.length > 0) {
    await db.userDevice.updateMany({
      data: { lastLocationAt: new Date() },
      where: { id: { in: [...new Set(accepted.map((point) => point.senderDeviceId))] }, userId },
    });
  }

  return {
    accepted: accepted.map((point) => point.clientPointId),
    discarded: [...discarded, ...overAllowance].map((point) => point.clientPointId),
    duplicates: allowed
      .filter((point) => !accepted.includes(point))
      .map((point) => point.clientPointId),
    expired: expired.map((point) => point.clientPointId),
  };
};

type LatestPointCursor = { senderDeviceId: string; updatedAt: Date };

const readLatestPoints = async ({
  cursor,
  db,
  groupId,
  joinedEpochNumber,
  limit,
}: {
  cursor: LatestPointCursor | null;
  db: GroupTrackingDb;
  groupId: string;
  joinedEpochNumber: number;
  limit: number | null;
}) => {
  const rows = await db.$queryRaw<
    Array<{
      epochId: string;
      payload: Uint8Array;
      revisionPrefix: string;
      senderDeviceId: string;
      senderUserId: string;
      updatedAt: Date;
    }>
  >(Prisma.sql`
    SELECT "latest"."senderDeviceId", "stream"."senderUserId", "stream"."epochId",
      "stream"."revisionPrefix", "latest"."payload", "latest"."updatedAt"
    FROM "TrackingLatestPoint" AS "latest"
    JOIN "TrackingStream" AS "stream" ON "stream"."id" = "latest"."streamId"
    JOIN "GroupEpoch" AS "epoch" ON "epoch"."id" = "stream"."epochId"
    WHERE "latest"."groupId" = ${groupId}
      AND "epoch"."epochNumber" >= ${joinedEpochNumber}
      ${
        cursor
          ? Prisma.sql`AND ("latest"."updatedAt", "latest"."senderDeviceId") > ((${cursor.updatedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${cursor.senderDeviceId})`
          : Prisma.empty
      }
    ORDER BY "latest"."updatedAt", "latest"."senderDeviceId"
    ${limit === null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}
  `);
  return rows.map(({ payload, ...row }) => ({ ...row, ...splitPayload(payload) }));
};

const splitPayload = (payload: Uint8Array) => ({
  ciphertext: encodeBase64(payload.subarray(XCHACHA20_NONCE_LENGTH)),
  nonce: encodeBase64(payload.subarray(0, XCHACHA20_NONCE_LENGTH)),
});

export const pollGroupTrackingPoints = async ({
  cursor,
  db,
  groupId,
  joinedEpochNumber,
  limit,
}: {
  cursor: LatestPointCursor | null | undefined;
  db: GroupTrackingDb;
  groupId: string;
  joinedEpochNumber: number;
  limit: number;
}) => {
  const points = await readLatestPoints({
    cursor: cursor ?? null,
    db,
    groupId,
    joinedEpochNumber,
    limit,
  });
  const sharing = await getGroupSharingStates(db, groupId);
  const last = points.at(-1);
  return {
    points: filterSharedPoints(points, sharing),
    sharing,
    cursor: last ? { senderDeviceId: last.senderDeviceId, updatedAt: last.updatedAt } : null,
    hasMore: points.length === limit,
  };
};

export const getLatestGroupTrackingPoints = async ({
  db,
  groupId,
  joinedEpochNumber,
}: {
  db: GroupTrackingDb;
  groupId: string;
  joinedEpochNumber: number;
}) => {
  const points = await readLatestPoints({
    cursor: null,
    db,
    groupId,
    joinedEpochNumber,
    limit: null,
  });
  const sharing = await getGroupSharingStates(db, groupId);
  return { points: filterSharedPoints(points, sharing), sharing };
};

const filterSharedPoints = <
  T extends { revisionPrefix: string; senderDeviceId: string; senderUserId: string },
>(
  points: T[],
  sharing: GroupDeviceSharingState[],
) =>
  points.filter((point) =>
    sharing.some(
      (device) =>
        device.deviceId === point.senderDeviceId &&
        device.userId === point.senderUserId &&
        !device.paused &&
        point.revisionPrefix === device.revisionPrefix,
    ),
  );

type HistoryDb = Pick<Prisma.TransactionClient, "$queryRaw">;

const utcTimestamp = (date: Date) =>
  Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

const historyStreams = (groupId: string, joinedEpochNumber: number) => Prisma.sql`
  SELECT "stream"."id", "stream"."senderUserId", "stream"."senderDeviceId", "stream"."epochId",
    "epoch"."epochNumber", "stream"."revisionPrefix"
  FROM "TrackingStream" AS "stream"
  JOIN "GroupEpoch" AS "epoch" ON "epoch"."id" = "stream"."epochId"
  JOIN "GroupMember" AS "member"
    ON "member"."groupId" = "stream"."groupId" AND "member"."userId" = "stream"."senderUserId"
  JOIN "UserDevice" AS "device"
    ON "device"."id" = "stream"."senderDeviceId" AND "device"."userId" = "stream"."senderUserId"
  WHERE "stream"."groupId" = ${groupId}
    AND "epoch"."epochNumber" >= ${joinedEpochNumber}
    AND "device"."revokedAt" IS NULL AND "device"."activatedAt" IS NOT NULL
`;

export const readGroupTrackingHistoryDays = async ({
  db,
  groupId,
  joinedEpochNumber,
}: {
  db: HistoryDb;
  groupId: string;
  joinedEpochNumber: number;
}) => {
  const windowStart = new Date((await readDatabaseTime(db)).getTime() - HISTORY_RETENTION_MS);
  const rows = await db.$queryRaw<
    Array<{
      count: number;
      firstReceivedAt: Date;
      hour: Date;
      senderDeviceId: string;
      senderUserId: string;
    }>
  >(Prisma.sql`
    SELECT "stream"."senderUserId", "stream"."senderDeviceId",
      date_trunc('hour', "point"."receivedAt") AS "hour", COUNT(*)::int AS "count",
      MIN("point"."receivedAt") AS "firstReceivedAt"
    FROM (${historyStreams(groupId, joinedEpochNumber)}) AS "stream"
    JOIN "TrackingPoint" AS "point" ON "point"."streamId" = "stream"."id"
    WHERE "point"."receivedAt" >= ${utcTimestamp(windowStart)}
    GROUP BY "stream"."senderUserId", "stream"."senderDeviceId", "hour"
    ORDER BY "stream"."senderUserId", "stream"."senderDeviceId", "hour"
  `);
  const devices = new Map<
    string,
    {
      firstReceivedAt: Date;
      hours: Array<{ count: number; hour: Date }>;
      senderDeviceId: string;
      senderUserId: string;
    }
  >();
  for (const { count, firstReceivedAt, hour, senderDeviceId, senderUserId } of rows) {
    const key = JSON.stringify([senderUserId, senderDeviceId]);
    const device = devices.get(key) ?? { firstReceivedAt, hours: [], senderDeviceId, senderUserId };
    device.hours.push({ count, hour });
    devices.set(key, device);
  }
  return { devices: [...devices.values()], windowStart };
};

export const readGroupTrackingHistoryRange = async ({
  cursor,
  db,
  from,
  groupId,
  joinedEpochNumber,
  limit,
  to,
}: {
  cursor: { pointId: string; receivedAt: Date; streamId: string } | undefined;
  db: HistoryDb;
  from: Date;
  groupId: string;
  joinedEpochNumber: number;
  limit: number;
  to: Date;
}) => {
  const now = await readDatabaseTime(db);
  const windowStart = new Date(now.getTime() - HISTORY_RETENTION_MS);
  const start = from > windowStart ? from : windowStart;
  const end = to < now ? to : now;
  const streams = historyStreams(groupId, joinedEpochNumber);
  type Row = {
    epochId: string;
    epochNumber: number;
    payload: Uint8Array;
    pointId: string;
    receivedAt: Date;
    revisionPrefix: string;
    senderDeviceId: string;
    senderUserId: string;
    streamId: string;
  };
  const columns = Prisma.sql`"stream"."id"::text AS "streamId", "stream"."senderUserId",
    "stream"."senderDeviceId", "stream"."epochId", "stream"."epochNumber", "stream"."revisionPrefix",
    "point"."pointId"::text AS "pointId", "point"."receivedAt", "point"."payload"`;
  const [rows, lookbackRows] = await Promise.all([
    db.$queryRaw<Row[]>(Prisma.sql`
      SELECT ${columns}
      FROM (${streams}) AS "stream"
      JOIN "TrackingPoint" AS "point" ON "point"."streamId" = "stream"."id"
      WHERE "point"."receivedAt" >= ${utcTimestamp(cursor && cursor.receivedAt > start ? cursor.receivedAt : start)}
        AND "point"."receivedAt" < ${utcTimestamp(end)}
        ${
          cursor
            ? Prisma.sql`AND ("point"."receivedAt", "point"."streamId", "point"."pointId")
                > (${utcTimestamp(cursor.receivedAt)}, ${cursor.streamId}::bigint, ${cursor.pointId}::bigint)`
            : Prisma.empty
        }
      ORDER BY "point"."receivedAt", "point"."streamId", "point"."pointId"
      LIMIT ${limit}
    `),
    cursor
      ? []
      : db.$queryRaw<Row[]>(Prisma.sql`
          WITH "stream" AS (${streams}),
          "lastBatch" AS (
            SELECT "stream"."senderUserId", "stream"."senderDeviceId",
              max("last"."receivedAt") AS "receivedAt"
            FROM "stream"
            CROSS JOIN LATERAL (
              SELECT "receivedAt"
              FROM "TrackingPoint"
              WHERE "TrackingPoint"."streamId" = "stream"."id"
                AND "TrackingPoint"."receivedAt" >= ${utcTimestamp(windowStart)}
                AND "TrackingPoint"."receivedAt" < ${utcTimestamp(start)}
              ORDER BY "TrackingPoint"."receivedAt" DESC
              LIMIT 1
            ) AS "last"
            GROUP BY "stream"."senderUserId", "stream"."senderDeviceId"
          )
          SELECT "batch".*
          FROM "lastBatch"
          CROSS JOIN LATERAL (
            SELECT ${columns}
            FROM "stream"
            JOIN "TrackingPoint" AS "point"
              ON "point"."streamId" = "stream"."id" AND "point"."receivedAt" = "lastBatch"."receivedAt"
            WHERE "stream"."senderUserId" = "lastBatch"."senderUserId"
              AND "stream"."senderDeviceId" = "lastBatch"."senderDeviceId"
            ORDER BY "stream"."id", "point"."pointId"
            LIMIT 100
          ) AS "batch"
          ORDER BY "batch"."senderUserId", "batch"."senderDeviceId", "batch"."streamId", "batch"."pointId"
        `),
  ]);
  const toPoint = ({ payload, pointId, receivedAt, streamId }: Row) => ({
    pointId,
    receivedAt,
    streamId,
    ...splitPayload(payload),
  });
  const involved = new Map(
    [...lookbackRows, ...rows].map(
      ({ epochId, epochNumber, revisionPrefix, senderDeviceId, senderUserId, streamId }) => [
        streamId,
        { id: streamId, senderUserId, senderDeviceId, epochId, epochNumber, revisionPrefix },
      ],
    ),
  );
  const last = rows.at(-1);
  return {
    streams: [...involved.values()],
    points: rows.map(toPoint),
    lookback: lookbackRows.map(toPoint),
    cursor: last
      ? { pointId: last.pointId, receivedAt: last.receivedAt, streamId: last.streamId }
      : null,
    hasMore: rows.length === limit,
  };
};
