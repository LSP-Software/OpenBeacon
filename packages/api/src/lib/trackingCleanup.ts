import { Prisma } from "@openbeacon/database";

export const deleteTrackingPointsInBatches = async ({
  db,
  streams,
  points = Prisma.sql`TRUE`,
  batchSize = 5_000,
  limit = Number.POSITIVE_INFINITY,
}: {
  db: Pick<Prisma.TransactionClient, "$queryRaw">;
  streams: Prisma.Sql;
  points?: Prisma.Sql;
  batchSize?: number;
  limit?: number;
}) => {
  let deleted = 0;
  let fromStream = "0";
  while (deleted < limit) {
    const take = Math.min(batchSize, limit - deleted);
    const rows = await db.$queryRaw<Array<{ streamId: string }>>(Prisma.sql`
      DELETE FROM "TrackingPoint"
      WHERE ("streamId", "pointId") IN (
        SELECT "batch"."streamId", "batch"."pointId"
        FROM "TrackingStream" AS "stream"
        CROSS JOIN LATERAL (
          SELECT "point"."streamId", "point"."pointId"
          FROM "TrackingPoint" AS "point"
          WHERE "point"."streamId" = "stream"."id" AND (${points})
          ORDER BY "point"."receivedAt"
          LIMIT ${take}
          FOR UPDATE SKIP LOCKED
        ) AS "batch"
        WHERE (${streams}) AND "stream"."id" >= ${fromStream}::bigint
        ORDER BY "stream"."id"
        LIMIT ${take}
      )
      RETURNING "streamId"::text AS "streamId"
    `);
    deleted += rows.length;
    if (rows.length < take) return deleted;
    fromStream = rows.reduce(
      (latest, { streamId }) => (BigInt(streamId) > BigInt(latest) ? streamId : latest),
      fromStream,
    );
  }
  return deleted;
};

export const deleteTrackingStreams = async ({
  db,
  streams,
}: {
  db: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;
  streams: Prisma.Sql;
}) => {
  await deleteTrackingPointsInBatches({ db, streams });
  return db.$executeRaw(Prisma.sql`DELETE FROM "TrackingStream" AS "stream" WHERE ${streams}`);
};
