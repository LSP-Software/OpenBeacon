import { GroupRole, Prisma, type PrismaClient } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";

export const deleteAccountRecords = async ({
  db,
  userId,
  imageUrlPrefix,
  mode,
}: {
  db: PrismaClient;
  userId: string;
  imageUrlPrefix: string;
  mode: "scheduled" | "immediate";
}) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return false;
    if (mode === "scheduled") {
      const [status] = await tx.$queryRaw<Array<{ due: boolean }>>(
        Prisma.sql`SELECT "pendingDeletion" AND "deletionDate" IS NOT NULL AND "deletionDate" <= (clock_timestamp() AT TIME ZONE 'UTC') AS due FROM "User" WHERE id = ${userId}`,
      );
      if (!status?.due) return false;
    }

    const memberships = await tx.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupIds = memberships.map(({ groupId }) => groupId).sort();
    const imageKeys: string[] = [];
    if (groupIds.length) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Group" WHERE id IN (${Prisma.join(groupIds)}) ORDER BY id FOR UPDATE`,
      );
      const soleOwner = await tx.groupMember.findFirst({
        where: {
          userId,
          role: GroupRole.OWNER,
          group: {
            AND: [
              { groupMembers: { some: { userId: { not: userId } } } },
              { groupMembers: { none: { userId: { not: userId }, role: GroupRole.OWNER } } },
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
        where: { id: { in: groupIds }, groupMembers: { none: { userId: { not: userId } } } },
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
          id: { in: groupIds.filter((id) => !soloGroups.some((group) => group.id === id)) },
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
    await tx.groupEncryptedPayload.deleteMany({ where: { senderUserId: userId } });
    await tx.groupEpochRecipientKey.deleteMany({ where: { recipientDevice: { userId } } });
    await tx.verification.deleteMany({ where: { identifier: user.email } });
    await tx.feedback.deleteMany({
      where: { email: { equals: user.email, mode: "insensitive" } },
    });
    await tx.user.delete({ where: { id: userId } });
    return true;
  });
