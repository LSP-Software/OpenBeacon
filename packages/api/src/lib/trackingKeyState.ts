import { createHash } from "node:crypto";
import { Prisma } from "@openbeacon/database";

export const getTrackingKeyState = async ({
  db,
  deviceId,
  userId,
}: {
  db: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> };
  deviceId: string;
  userId: string;
}) => {
  const [groups, account] = await Promise.all([
    db.$queryRaw<
      {
        groupId: string;
        rotationRequired: boolean;
        latestEpochId: string | null;
        members: string;
      }[]
    >(Prisma.sql`
      SELECT "member"."groupId", "group"."epochRotationRequired" AS "rotationRequired",
        (SELECT "epoch"."id" FROM "GroupEpoch" AS "epoch"
          WHERE "epoch"."groupId" = "member"."groupId"
          ORDER BY "epoch"."epochNumber" DESC LIMIT 1) AS "latestEpochId",
        (SELECT string_agg("other"."id", ',' ORDER BY "other"."id") FROM "GroupMember" AS "other"
          WHERE "other"."groupId" = "member"."groupId") AS "members"
      FROM "GroupMember" AS "member"
      JOIN "Group" AS "group" ON "group"."id" = "member"."groupId"
      WHERE "member"."userId" = ${userId}
      ORDER BY "member"."groupId"
    `),
    db.$queryRaw<
      { accountRevision: number; deviceRevision: number | null; historyKeyVersion: number | null }[]
    >(Prisma.sql`
      SELECT "account"."sharingRevision" AS "accountRevision",
        (SELECT "device"."sharingRevision" FROM "UserDevice" AS "device"
          WHERE "device"."id" = ${deviceId} AND "device"."userId" = ${userId}) AS "deviceRevision",
        (SELECT MAX("historyKey"."version") FROM "AccountHistoryKey" AS "historyKey"
          WHERE "historyKey"."userId" = ${userId}) AS "historyKeyVersion"
      FROM "User" AS "account"
      WHERE "account"."id" = ${userId}
    `),
  ]);
  return createHash("sha256")
    .update(JSON.stringify({ account: account[0] ?? null, groups }))
    .digest("base64url")
    .slice(0, 22);
};
