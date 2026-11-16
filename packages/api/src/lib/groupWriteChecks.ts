import type { GroupRole } from "@openbeacon/database";
import { Prisma } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { ReasonError } from "./reasonError.ts";

export type GroupWriteChecksDb = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  groupEpoch: {
    count: (args: { where: { id: { in: string[] } } }) => Promise<number>;
    findMany: (args: {
      select: { id: true };
      where: { groupId: string; id: { in: string[] }; createdAt?: { gte: Date } };
    }) => Promise<Array<{ id: string }>>;
  };
  userDevice: {
    findMany: (args: {
      select: { id: true; userId: true };
      where: {
        id: { in: string[] };
        revokedAt: null;
        activatedAt: { not: null };
        userId: string;
      };
    }) => Promise<Array<{ id: string; userId: string }>>;
  };
};

const epochNotInGroup = () =>
  new TRPCError({ code: "BAD_REQUEST", message: "Epoch does not belong to this group." });

export const lockGroupMemberForWrite = async (
  db: Pick<GroupWriteChecksDb, "$queryRaw">,
  {
    groupId,
    groupLock,
    otherUserIds = [],
    userId,
  }: {
    groupId: string;
    groupLock: "FOR SHARE" | "FOR NO KEY UPDATE";
    otherUserIds?: string[];
    userId: string;
  },
) => {
  const userIds = [...new Set([userId, ...otherUserIds])].sort();
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR SHARE`,
  );
  const groups = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM "Group" WHERE id = ${groupId} ${Prisma.raw(groupLock)}`,
  );
  if (!groups.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This group no longer exists.",
      cause: new ReasonError("GROUP_GONE"),
    });
  }
  const members = await db.$queryRaw<
    Array<{ id: string; createdAt: Date; role: GroupRole }>
  >(Prisma.sql`
    SELECT id, "createdAt", role FROM "GroupMember"
    WHERE "groupId" = ${groupId} AND "userId" = ${userId}
    FOR SHARE
  `);
  const member = members[0];
  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this group",
      cause: new ReasonError("NOT_GROUP_MEMBER"),
    });
  }
  return member;
};

export const assertSentFromThisDevice = (
  items: Array<{ senderDeviceId: string }>,
  deviceId: string,
  message: string,
) => {
  if (items.some((item) => item.senderDeviceId !== deviceId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message,
      cause: new ReasonError("DEVICE_NOT_REGISTERED"),
    });
  }
};

export const assertActiveDevices = async (
  db: Pick<GroupWriteChecksDb, "userDevice">,
  { deviceIds, userId }: { deviceIds: string[]; userId: string },
) => {
  const devices = await db.userDevice.findMany({
    select: { id: true, userId: true },
    where: { id: { in: deviceIds }, revokedAt: null, activatedAt: { not: null }, userId },
  });
  if (devices.length !== deviceIds.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The active device is not registered.",
      cause: new ReasonError("DEVICE_NOT_REGISTERED"),
    });
  }
};

export const findGroupEpochs = async (
  db: Pick<GroupWriteChecksDb, "groupEpoch">,
  { epochIds, groupId, memberSince }: { epochIds: string[]; groupId: string; memberSince?: Date },
) => {
  const epochs = await db.groupEpoch.findMany({
    select: { id: true },
    where: {
      groupId,
      id: { in: epochIds },
      ...(memberSince ? { createdAt: { gte: memberSince } } : {}),
    },
  });
  const found = new Set(epochs.map((epoch) => epoch.id));
  const missing = epochIds.filter((epochId) => !found.has(epochId));
  if (missing.length > 0 && (await db.groupEpoch.count({ where: { id: { in: missing } } })) > 0) {
    throw epochNotInGroup();
  }
  return found;
};

export const assertLatestGroupEpoch = async (
  db: Pick<Prisma.TransactionClient, "group" | "groupEpoch">,
  { epochIds, groupId }: { epochIds: string[]; groupId: string },
) => {
  const group = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    select: {
      epochRotationRequired: true,
      groupEpochs: { orderBy: { epochNumber: "desc" }, take: 1, select: { id: true } },
    },
  });
  const latestEpochId = group.groupEpochs[0]?.id;
  const notLatest = epochIds.filter((epochId) => epochId !== latestEpochId);
  if (
    notLatest.length > 0 &&
    (await db.groupEpoch.count({ where: { id: { in: notLatest }, groupId: { not: groupId } } })) > 0
  ) {
    throw epochNotInGroup();
  }
  if (group.epochRotationRequired) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This group's keys need to change first. Try again shortly.",
      cause: new ReasonError("EPOCH_ROTATION_PENDING"),
    });
  }
  if (notLatest.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This can only be saved with the group's latest keys.",
      cause: new ReasonError("EPOCH_NOT_LATEST"),
    });
  }
};
