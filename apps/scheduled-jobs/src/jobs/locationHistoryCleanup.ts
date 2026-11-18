import { effectiveHistoryShareSql, historyFirstHourSql } from "@openbeacon/api/historyShare.ts";
import { deleteTrackingPointsInBatches } from "@openbeacon/api/trackingCleanup.ts";
import { Prisma } from "@openbeacon/database";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

const retentionCutoff = async () =>
  new Date((await getDatabaseTime()).getTime() - 14 * 24 * 60 * 60_000).toISOString();

export const createLocationHistoryCleanup =
  ({ batchSize = 1_000, runLimit = 500_000 }: { batchSize?: number; runLimit?: number } = {}) =>
  async () => {
    const now = await getDatabaseTime();
    const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60_000).toISOString();
    const nowHour = Math.floor(now.getTime() / 3_600_000);
    const cutoffHour = Math.floor(new Date(cutoff).getTime() / 3_600_000);
    const result = await tryCatch(
      (async () => {
        const deleted = await deleteTrackingPointsInBatches({
          db: services.db,
          streams: Prisma.sql`"stream"."createdAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')`,
          points: Prisma.sql`"point"."capturedHour" <= ${cutoffHour} AND "point"."receivedHour" < ${cutoffHour}`,
          batchSize,
          limit: runLimit,
        });
        const outsideShare =
          deleted < runLimit
            ? await deleteTrackingPointsInBatches({
                db: services.db,
                streamJoins: Prisma.sql`
                  JOIN "GroupMember" AS "member"
                    ON "member"."groupId" = "stream"."groupId" AND "member"."userId" = "stream"."senderUserId"
                  JOIN "User" AS "account" ON "account"."id" = "stream"."senderUserId"`,
                streams: Prisma.sql`${effectiveHistoryShareSql} <> 'MAXIMUM'`,
                points: Prisma.sql`"point"."capturedHour" < ${historyFirstHourSql(nowHour, 0)}`,
                batchSize,
                limit: runLimit - deleted,
              })
            : 0;
        await services.db.$executeRaw`
          DELETE FROM "TrackingLatestPoint"
          WHERE "updatedAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
        `;
        let afterStream = "0";
        while (true) {
          const locked = await services.db.$transaction(async (tx) => {
            const streams = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "stream".id::text AS id FROM "TrackingStream" AS "stream"
              WHERE "stream".id > ${afterStream}::bigint
                AND NOT EXISTS (SELECT 1 FROM "TrackingPoint" AS "point" WHERE "point"."streamId" = "stream".id)
                AND NOT EXISTS (
                  SELECT 1 FROM "TrackingLatestPoint" AS "latest" WHERE "latest"."streamId" = "stream".id
                )
              ORDER BY "stream".id
              LIMIT ${batchSize}
              FOR UPDATE SKIP LOCKED
            `;
            if (streams.length === 0) return streams;
            await tx.$executeRaw`
              DELETE FROM "TrackingStream" AS "stream"
              WHERE "stream".id = ANY(${streams.map(({ id }) => id)}::bigint[])
                AND NOT EXISTS (SELECT 1 FROM "TrackingPoint" AS "point" WHERE "point"."streamId" = "stream".id)
                AND NOT EXISTS (
                  SELECT 1 FROM "TrackingLatestPoint" AS "latest" WHERE "latest"."streamId" = "stream".id
                )
            `;
            return streams;
          });
          const last = locked.at(-1);
          if (!last || locked.length < batchSize) return deleted + outsideShare;
          afterStream = last.id;
        }
      })(),
    );
    if (result.error) {
      const code = errorCode(result.error);
      console.error(`Location history clean-up failed${code ? ` (${code})` : ""}`);
      return;
    }
    if (result.data < runLimit) return;
    console.warn(
      `Location history clean-up reached its limit of ${runLimit} points; the rest will be deleted on later runs`,
    );
  };

export const createGroupHistoryCleanup =
  ({ batchSize = 1_000, runLimit = 500_000 }: { batchSize?: number; runLimit?: number } = {}) =>
  async () => {
    const cutoff = await retentionCutoff();
    const deleteBatches = async (
      table: string,
      deleteBatch: (limit: number) => Promise<number>,
    ) => {
      let deleted = 0;
      while (deleted < runLimit) {
        const limit = Math.min(batchSize, runLimit - deleted);
        const result = await tryCatch(deleteBatch(limit));
        if (result.error) {
          const code = errorCode(result.error);
          console.error(`${table} clean-up failed${code ? ` (${code})` : ""}`);
          return;
        }
        deleted += result.data;
        if (result.data < limit) return;
      }
      console.warn(
        `${table} clean-up reached its limit of ${runLimit} rows; the rest will be deleted on later runs`,
      );
    };
    await deleteBatches(
      "Place transition",
      (limit) => services.db.$executeRaw`
        DELETE FROM "PlaceTransition"
        WHERE id IN (
          SELECT id FROM "PlaceTransition"
          WHERE "occurredAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
          ORDER BY "occurredAt"
          LIMIT ${limit}
        )
      `,
    );
    await deleteBatches(
      "Group event",
      (limit) => services.db.$executeRaw`
        DELETE FROM "GroupEvent"
        WHERE id IN (
          SELECT id FROM "GroupEvent"
          WHERE "createdAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
          ORDER BY "createdAt"
          LIMIT ${limit}
        )
      `,
    );
  };

export const createEpochCleanup =
  ({ pageSize = 5_000 }: { pageSize?: number } = {}) =>
  async () => {
    const cutoff = await retentionCutoff();
    let after = { createdAt: new Date(0).toISOString(), id: "" };
    while (true) {
      const page: Array<{ id: string; createdAt: Date }> = await services.db.$queryRaw`
        SELECT id, "createdAt" FROM "GroupEpoch"
        WHERE "createdAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
          AND ("createdAt", id) > ((${after.createdAt}::timestamptz AT TIME ZONE 'UTC'), ${after.id})
        ORDER BY "createdAt", id
        LIMIT ${pageSize}
      `;
      const last = page.at(-1);
      if (!last) return;
      const result = await tryCatch(
        services.db.$executeRaw`
          DELETE FROM "GroupEpoch"
          WHERE id IN (
            SELECT e.id FROM "GroupEpoch" e
            WHERE e.id = ANY(${page.map(({ id }) => id)})
              AND EXISTS (
                SELECT 1 FROM "GroupEpoch" n
                WHERE n."groupId" = e."groupId"
                  AND n."epochNumber" > e."epochNumber"
                  AND n."createdAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')
              )
              AND NOT EXISTS (
                SELECT 1 FROM "TrackingStream" s
                WHERE s."groupId" = e."groupId" AND s."epochId" = e.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM "Place" pl WHERE pl."epochId" = e.id
              )
            FOR UPDATE OF e SKIP LOCKED
          )
        `,
      );
      if (result.error) {
        const code = errorCode(result.error);
        console.error(`Epoch clean-up failed${code ? ` (${code})` : ""}`);
        return;
      }
      if (page.length < pageSize) return;
      after = { createdAt: last.createdAt.toISOString(), id: last.id };
    }
  };
