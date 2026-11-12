import { Prisma } from "@openbeacon/database";
import { resolveLocationSharing, type SharingPreference } from "@openbeacon/shared";

export const getGroupSharingStates = async (
  db: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  groupId: string,
) => {
  const devices = await db.$queryRaw<
    (SharingPreference & {
      deviceId: string;
      userId: string;
      accountPaused: boolean;
      accountPausedUntil: Date | null;
      accountChangedAt: Date | null;
      accountRevision: number;
    })[]
  >(Prisma.sql`
    SELECT "device"."id" AS "deviceId", "device"."userId",
      "device"."sharingPaused", "device"."sharingPausedUntil",
      "device"."sharingChangedAt", "device"."sharingRevision",
      "account"."sharingPaused" AS "accountPaused",
      "account"."sharingPausedUntil" AS "accountPausedUntil",
      "account"."sharingChangedAt" AS "accountChangedAt",
      "account"."sharingRevision" AS "accountRevision"
    FROM "UserDevice" AS "device"
    JOIN "User" AS "account" ON "account"."id" = "device"."userId"
    JOIN "GroupMember" AS "member" ON "member"."userId" = "device"."userId"
    WHERE "member"."groupId" = ${groupId}
      AND "device"."revokedAt" IS NULL AND "device"."activatedAt" IS NOT NULL
  `);
  const now = Date.now();
  return devices.map((device) => {
    const sharing = resolveLocationSharing(
      {
        sharingPaused: device.accountPaused,
        sharingPausedUntil: device.accountPausedUntil,
        sharingChangedAt: device.accountChangedAt,
        sharingRevision: device.accountRevision,
      },
      device,
      now,
    );
    return {
      deviceId: device.deviceId,
      userId: device.userId,
      ...sharing,
      ...(sharing.paused ? { pausedUntil: null, resumeAfter: null } : {}),
    };
  });
};
