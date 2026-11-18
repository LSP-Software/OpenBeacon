import { readDatabaseTime } from "@openbeacon/database";
import { services } from "../services.ts";

export const findTopUploadGrowth = async ({ limit = 10 }: { limit?: number } = {}) => {
  const dayAgoHour = Math.floor((await readDatabaseTime(services.db)).getTime() / 3_600_000) - 24;
  return services.db.$queryRaw<Array<{ userId: string; groups: number; points: number }>>`
    SELECT "stream"."senderUserId" AS "userId",
      COUNT(DISTINCT "stream"."groupId")::int AS groups,
      COUNT(*)::int AS points
    FROM "TrackingStream" AS "stream"
    JOIN "TrackingPoint" AS "point" ON "point"."streamId" = "stream"."id"
    WHERE "point"."receivedHour" >= ${dayAgoHour}
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
