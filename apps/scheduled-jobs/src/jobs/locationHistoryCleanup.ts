import { deletePayloadsInBatches } from "@openbeacon/api/deletePayloadsInBatches.ts";
import { Prisma } from "@openbeacon/database";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

const retentionCutoff = async () =>
  new Date((await getDatabaseTime()).getTime() - 60 * 24 * 60 * 60_000).toISOString();

export const createLocationHistoryCleanup =
  ({ batchSize = 1_000, runLimit = 500_000 }: { batchSize?: number; runLimit?: number } = {}) =>
  async () => {
    const cutoff = await retentionCutoff();
    const result = await tryCatch(
      deletePayloadsInBatches({
        db: services.db,
        where: Prisma.sql`kind = ${TRACKING_POINT_KIND} AND "createdAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')`,
        orderBy: Prisma.sql`ORDER BY "createdAt"`,
        batchSize,
        limit: runLimit,
      }),
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
                SELECT 1 FROM "GroupEncryptedPayload" p WHERE p."epochId" = e.id
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
