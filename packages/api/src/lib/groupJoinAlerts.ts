import type { Prisma } from "@openbeacon/database";

export const createGroupJoinAlerts = async ({
  db,
  groupId,
  userId,
}: {
  db: Prisma.TransactionClient;
  groupId: string;
  userId: string;
}) => {
  const [member, recipients] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
    db.groupMember.findMany({
      where: { groupId, userId: { not: userId } },
      select: { userId: true },
    }),
  ]);
  await db.groupJoinAlert.createMany({
    data: recipients.map(({ userId: recipientId }) => ({
      groupId,
      recipientId,
      memberName: member.name,
    })),
  });
};
