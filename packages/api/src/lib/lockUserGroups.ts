import { Prisma } from "@openbeacon/database";

export const lockUserGroups = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw" | "groupMember">,
  userId: string,
  otherGroupIds: string[] = [],
) => {
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map(({ groupId }) => groupId);
  const lockIds = [...new Set([...groupIds, ...otherGroupIds])];
  if (lockIds.length) {
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM "Group" WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`,
    );
  }
  return groupIds;
};
