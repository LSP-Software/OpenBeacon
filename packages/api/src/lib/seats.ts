import { Prisma } from "@openbeacon/database";

const ownedGroupIdsSql = (userId: string) =>
  Prisma.sql`SELECT "groupId" FROM "GroupMember" WHERE "userId" = ${userId} AND "role" = 'OWNER'`;

export const accountSeats = async (db: Pick<Prisma.TransactionClient, "user">, userId: string) =>
  (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { seats: true } })).seats;

export const seatsUsed = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
) => {
  const [row] = await db.$queryRaw<[{ used: number }]>`
    SELECT count(*)::int AS "used"
    FROM "GroupMember" AS "member"
    JOIN "UserDevice" AS "device"
      ON "device"."userId" = "member"."userId"
      AND "device"."activatedAt" IS NOT NULL
      AND "device"."revokedAt" IS NULL
    WHERE "member"."groupId" IN (${ownedGroupIdsSql(userId)})
  `;
  return row.used;
};

export const seatsEnforced = ({ selfHosted }: { selfHosted: boolean }) => !selfHosted;
