import { Prisma } from "@openbeacon/database";
import { decodeBase64, encodeBase64, XCHACHA20_NONCE_LENGTH } from "@openbeacon/encryption";
import type { groupTrackingPointSchema } from "@openbeacon/schemas";
import type { GroupDeviceSharingState } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import type { GroupWriteChecksDb } from "./groupWriteChecks.ts";
import { assertActiveDevices, findGroupEpochs } from "./groupWriteChecks.ts";
import { getGroupSharingStates } from "./locationSharing.ts";

type GroupTrackingDb = GroupWriteChecksDb & {
  userDevice: {
    updateMany: (args: {
      data: { lastLocationAt: Date };
      where: { id: { in: string[] }; userId: string };
    }) => Promise<{ count: number }>;
  };
};

type TrackingPointUpload = z.infer<typeof groupTrackingPointSchema>;

export const parseClientPointId = (clientPointId: string) => {
  const separator = clientPointId.lastIndexOf(":");
  const bytes = decodeBase64(clientPointId.slice(separator + 1));
  return {
    pointId: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0),
    revisionPrefix: clientPointId.slice(0, separator + 1),
  };
};

export const uploadGroupTrackingBatch = async ({
  db,
  groupId,
  memberSince,
  points,
  takeAllowance,
  userId,
}: {
  db: GroupTrackingDb;
  groupId: string;
  memberSince?: Date;
  points: TrackingPointUpload[];
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

  const streamKey = (point: { epochId: string; revisionPrefix: string; senderDeviceId: string }) =>
    JSON.stringify([point.epochId, point.senderDeviceId, point.revisionPrefix]);
  const streamIds = new Map<string, string>();
  for (const point of kept) {
    const key = streamKey(point);
    if (streamIds.has(key)) continue;
    const findStream = async () => {
      const [stream] = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id::text AS id FROM "TrackingStream"
        WHERE "groupId" = ${groupId} AND "epochId" = ${point.epochId}
          AND "senderDeviceId" = ${point.senderDeviceId} AND "revisionPrefix" = ${point.revisionPrefix}
        FOR SHARE
      `);
      return stream;
    };
    let stream = await findStream();
    if (!stream) {
      await db.$queryRaw(Prisma.sql`
        INSERT INTO "TrackingStream" ("groupId", "epochId", "senderDeviceId", "senderUserId", "revisionPrefix", "createdAt")
        VALUES (${groupId}, ${point.epochId}, ${point.senderDeviceId}, ${userId}, ${point.revisionPrefix}, (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("groupId", "epochId", "senderDeviceId", "revisionPrefix") DO NOTHING
      `);
      stream = await findStream();
    }
    if (!stream) throw new Error("Tracking stream was not created.");
    streamIds.set(key, stream.id);
  }
  const withStreams = kept.map((point) => ({
    ...point,
    streamId: streamIds.get(streamKey(point)) ?? "",
  }));
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
  const overAllowance: typeof newRows = [];
  for (const senderDeviceId of new Set(newRows.map((point) => point.senderDeviceId))) {
    const deviceRows = newRows.filter((point) => point.senderDeviceId === senderDeviceId);
    const granted = await takeAllowance(senderDeviceId, deviceRows.length);
    overAllowance.push(...deviceRows.slice(granted));
  }
  const allowed = withStreams.filter((point) => !overAllowance.includes(point));
  const insertOrder = [...allowed].sort((first, second) =>
    first.streamId === second.streamId
      ? Number(first.pointId > second.pointId) - Number(first.pointId < second.pointId)
      : Number(BigInt(first.streamId) > BigInt(second.streamId)) -
        Number(BigInt(first.streamId) < BigInt(second.streamId)),
  );

  const storePoints = async (role: "POINT" | "STAY") => {
    const rows = insertOrder.filter((point) => point.role === role);
    if (rows.length === 0) return new Set<string>();
    const stored = await db.$queryRaw<Array<{ streamId: string; pointId: string }>>(Prisma.sql`
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
      RETURNING "streamId"::text AS "streamId", "pointId"::text AS "pointId"
    `);
    return new Set(stored.map(pointKey));
  };
  const storedPoints = await storePoints("POINT");
  await storePoints("STAY");
  const accepted = allowed.filter(
    (point) => point.role !== "POINT" || storedPoints.has(pointKey(point)),
  );

  const latestByDevice = new Map(
    withStreams
      .filter(
        (point) =>
          point.role !== "STAY" && (accepted.includes(point) || overAllowance.includes(point)),
      )
      .map((point) => [point.senderDeviceId, point]),
  );
  for (const latest of latestByDevice.values()) {
    await db.$queryRaw(Prisma.sql`
      INSERT INTO "TrackingLatestPoint" ("groupId", "senderDeviceId", "streamId", "payload", "updatedAt")
      VALUES (${groupId}, ${latest.senderDeviceId}, ${latest.streamId}::bigint,
        decode(${latest.nonce}, 'base64') || decode(${latest.ciphertext}, 'base64'),
        (now() AT TIME ZONE 'UTC'))
      ON CONFLICT ("groupId", "senderDeviceId") DO UPDATE SET
        "streamId" = EXCLUDED."streamId", "payload" = EXCLUDED."payload", "updatedAt" = EXCLUDED."updatedAt"
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

const readLatestPoints = async ({
  cursor,
  db,
  groupId,
  joinedEpochNumber,
  limit,
}: {
  cursor: { senderDeviceId: string; updatedAt: Date } | null;
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
  return rows.map(({ payload, ...row }) => ({
    ...row,
    ciphertext: encodeBase64(payload.subarray(XCHACHA20_NONCE_LENGTH)),
    nonce: encodeBase64(payload.subarray(0, XCHACHA20_NONCE_LENGTH)),
  }));
};

export const pollGroupTrackingPoints = async ({
  cursor,
  db,
  groupId,
  joinedEpochNumber,
  limit,
}: {
  cursor: { senderDeviceId: string; updatedAt: Date } | null | undefined;
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
