import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

export const findTopUploadGrowth = async ({ limit = 10 }: { limit?: number } = {}) => {
  const dayAgo = new Date((await getDatabaseTime()).getTime() - 24 * 60 * 60_000).toISOString();
  return services.db.$queryRaw<Array<{ userId: string; groups: number; points: number }>>`
    SELECT "stream"."senderUserId" AS "userId",
      COUNT(DISTINCT "stream"."groupId")::int AS groups,
      COUNT(*)::int AS points
    FROM "TrackingStream" AS "stream"
    JOIN "TrackingPoint" AS "point" ON "point"."streamId" = "stream"."id"
    WHERE "point"."receivedAt" >= (${dayAgo}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY "stream"."senderUserId"
    ORDER BY points DESC, "stream"."senderUserId"
    LIMIT ${limit}
  `;
};

export const runUploadGrowthReport = async () => {
  const accounts = await findTopUploadGrowth();
  if (!accounts.length) return;
  console.log("Accounts with the most location points stored in the last 24 hours", accounts);
};
