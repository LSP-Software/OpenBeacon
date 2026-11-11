import { Prisma } from "@openbeacon/database";

export const lockUserGroups = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw" | "groupMember">,
  userId: string,
) => {
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map(({ groupId }) => groupId);
  if (groupIds.length) {
    await db.$queryRaw(
      Prisma.sql`SELECT id FROM "Group" WHERE id IN (${Prisma.join(groupIds)}) ORDER BY id FOR UPDATE`,
    );
  }
  return groupIds;
};
