import { Prisma } from "@openbeacon/database";
import { HISTORY_SHARES, historyShareFirstHour, type HistoryShare } from "@openbeacon/shared";
import { deleteTrackingPointsInBatches } from "./trackingCleanup.ts";

export const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60_000;

export const effectiveHistoryShareSql = Prisma.sql`COALESCE("member"."historyShare", "account"."historyShare")`;

export const historyFirstHour = (share: HistoryShare, nowHour: number, maximumFirstHour: number) =>
  share === "LAST_LOCATION"
    ? 2_147_483_647
    : (historyShareFirstHour(share, nowHour) ?? maximumFirstHour);

export const historyFirstHourSql = (nowHour: number, maximumFirstHour: number) =>
  Prisma.sql`(CASE ${effectiveHistoryShareSql} ${Prisma.join(
    HISTORY_SHARES.map(
      (share) =>
        Prisma.sql`WHEN ${share}::"HistoryShare" THEN ${historyFirstHour(share, nowHour, maximumFirstHour)}::int4`,
    ),
    " ",
  )} END)`;

const transactionHourSql = Prisma.sql`floor(extract(epoch FROM now()) / 3600)::int4`;

export const readUploaderHistoryWindow = async (
  db: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  { groupId, userId }: { groupId: string; userId: string },
) => {
  const [row] = await db.$queryRaw<Array<{ historyShare: HistoryShare; nowHour: number }>>(
    Prisma.sql`
      SELECT ${effectiveHistoryShareSql}::text AS "historyShare", ${transactionHourSql} AS "nowHour"
      FROM "GroupMember" AS "member"
      JOIN "User" AS "account" ON "account"."id" = "member"."userId"
      WHERE "member"."groupId" = ${groupId} AND "member"."userId" = ${userId}
    `,
  );
  if (!row) throw new Error("Uploader is not a member of the group.");
  return { firstHour: historyFirstHour(row.historyShare, row.nowHour, 0), nowHour: row.nowHour };
};

export const deleteHistoryOutsideShare = async ({
  db,
  groupIds,
  historyShare,
  userId,
}: {
  db: Pick<Prisma.TransactionClient, "$queryRaw">;
  groupIds: string[];
  historyShare: HistoryShare;
  userId: string;
}) => {
  if (historyShare === "MAXIMUM" || groupIds.length === 0) return 0;
  const [{ nowHour }] = await db.$queryRaw<[{ nowHour: number }]>(
    Prisma.sql`SELECT ${transactionHourSql} AS "nowHour"`,
  );
  const firstHour = historyFirstHour(historyShare, nowHour, 0);
  return deleteTrackingPointsInBatches({
    db,
    streams: Prisma.sql`"stream"."senderUserId" = ${userId} AND "stream"."groupId" IN (${Prisma.join(groupIds)})`,
    points: Prisma.sql`"point"."capturedHour" < ${firstHour}`,
  });
};
