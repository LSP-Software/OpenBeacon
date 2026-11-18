import { Prisma } from "@openbeacon/database";

const countSeats = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  groupIds: Prisma.Sql,
) => {
  const [row] = await db.$queryRaw<[{ used: number }]>`
    SELECT count(*)::int AS "used"
    FROM "GroupMember" AS "member"
    JOIN "UserDevice" AS "device"
      ON "device"."userId" = "member"."userId"
      AND "device"."activatedAt" IS NOT NULL
      AND "device"."revokedAt" IS NULL
    WHERE "member"."groupId" IN (${groupIds})
  `;
  return row.used;
};

export const accountSeats = async (db: Pick<Prisma.TransactionClient, "user">, userId: string) =>
  (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { seats: true } })).seats;

export const seatsUsed = (db: Pick<Prisma.TransactionClient, "$queryRaw">, userId: string) =>
  countSeats(db, Prisma.sql`SELECT "id" FROM "Group" WHERE "ownerId" = ${userId}`);

export const groupSeats = (db: Pick<Prisma.TransactionClient, "$queryRaw">, groupId: string) =>
  countSeats(db, Prisma.sql`${groupId}`);

export const seatsEnforced = ({ selfHosted }: { selfHosted: boolean }) => !selfHosted;
