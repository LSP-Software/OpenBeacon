import { findAlertRecipient, type SecurityAlerts } from "@openbeacon/auth/securityAlerts.ts";
import { GroupRole, Prisma, type PrismaClient } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { deletePayloadsInBatches } from "./deletePayloadsInBatches.ts";
import { lockUserGroups } from "./lockUserGroups.ts";

export const deleteAccountRecords = async ({
  db,
  userId,
  imageUrlPrefix,
  mode,
  securityAlerts,
}: {
  db: PrismaClient;
  userId: string;
  imageUrlPrefix: string;
  mode: "scheduled" | "immediate";
  securityAlerts: SecurityAlerts | null;
}) => {
  const lockDueUser = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`);
    const [status] = await tx.$queryRaw<Array<{ due: boolean }>>(
      Prisma.sql`SELECT "pendingDeletion" AND "deletionDate" IS NOT NULL AND "deletionDate" <= (clock_timestamp() AT TIME ZONE 'UTC') AS due FROM "User" WHERE id = ${userId}`,
    );
    return status !== undefined && (mode === "immediate" || status.due);
  };
  if (!(await db.$transaction(lockDueUser))) return false;
  await deletePayloadsInBatches({
    db,
    where: Prisma.sql`"senderUserId" = ${userId}`,
  });

  const recipient = await db.$transaction(
    async (tx) => {
      if (!(await lockDueUser(tx))) return null;
      const user = await findAlertRecipient(tx, userId);
      if (!user) return null;

      const groupIds = await lockUserGroups(tx, userId);
      const imageKeys: string[] = [];
      if (groupIds.length) {
        const soleOwner = await tx.groupMember.findFirst({
          where: {
            userId,
            role: GroupRole.OWNER,
            group: {
              AND: [
                { groupMembers: { some: { userId: { not: userId } } } },
                {
                  groupMembers: {
                    none: { userId: { not: userId }, role: GroupRole.OWNER },
                  },
                },
              ],
            },
          },
          select: { id: true },
        });
        if (soleOwner)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Transfer ownership or delete your groups before deleting your account.",
          });
        const soloGroups = await tx.group.findMany({
          where: {
            id: { in: groupIds },
            groupMembers: { none: { userId: { not: userId } } },
          },
          select: { id: true, image: true },
        });
        for (const group of soloGroups) {
          if (group.image) {
            if (!group.image.startsWith(`${imageUrlPrefix}/`))
              throw new Error("Cannot identify group image for cleanup.");
            imageKeys.push(group.image.slice(imageUrlPrefix.length + 1));
          }
          const uploads = await tx.pendingUpload.findMany({
            where: { groupId: group.id },
            select: { userId: true, fileName: true },
          });
          for (const upload of uploads)
            imageKeys.push(
              `user/${upload.userId}/uploads/group/${group.id}/avatar/${upload.fileName}`,
            );
          await tx.pendingUpload.deleteMany({ where: { groupId: group.id } });
          await tx.group.delete({ where: { id: group.id } });
        }
        await tx.group.updateMany({
          where: {
            id: {
              in: groupIds.filter((id) => !soloGroups.some((group) => group.id === id)),
            },
          },
          data: { epochRotationRequired: true },
        });
      }

      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      if (!clock) throw new Error("Unable to read database time.");
      await tx.accountDeletionCleanup.upsert({
        where: { userId },
        create: { userId, createdAt: clock.now, imageKeys },
        update: { imageKeys: { push: imageKeys } },
      });
      await tx.group.updateMany({
        where: { image: { startsWith: `${imageUrlPrefix}/user/${userId}/` } },
        data: { image: null },
      });
      await tx.groupEncryptedPayload.deleteMany({
        where: { senderUserId: userId },
      });
      await tx.groupEpochRecipientKey.deleteMany({
        where: { recipientDevice: { userId } },
      });
      await tx.feedback.deleteMany({
        where: { email: { equals: user.email, mode: "insensitive" } },
      });
      await tx.user.delete({ where: { id: userId } });
      return user;
    },
    { timeout: 60_000 },
  );
  if (!recipient) return false;
  securityAlerts?.sendTo(recipient, { type: "account-deleted" });
  return true;
};
