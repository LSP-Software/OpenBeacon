import { Prisma } from "@openbeacon/database";
import {
  resolveLocationSharing,
  type GroupDeviceSharingState,
  type SharingPreference,
} from "@openbeacon/shared";

type SharingDb = { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> };

type SharingRow = SharingPreference & {
  deviceId: string;
  userId: string;
  accountPaused: boolean;
  accountPausedUntil: Date | null;
  accountChangedAt: Date | null;
  accountRevision: number;
};

const sharingColumns = Prisma.sql`
  "device"."id" AS "deviceId", "device"."userId",
  "device"."sharingPaused", "device"."sharingPausedUntil",
  "device"."sharingChangedAt", "device"."sharingRevision",
  "account"."sharingPaused" AS "accountPaused",
  "account"."sharingPausedUntil" AS "accountPausedUntil",
  "account"."sharingChangedAt" AS "accountChangedAt",
  "account"."sharingRevision" AS "accountRevision"
`;

const resolveRow = (device: SharingRow, now: number) =>
  resolveLocationSharing(
    {
      sharingPaused: device.accountPaused,
      sharingPausedUntil: device.accountPausedUntil,
      sharingChangedAt: device.accountChangedAt,
      sharingRevision: device.accountRevision,
    },
    device,
    now,
  );

export const getGroupSharingStates = async (
  db: SharingDb,
  groupId: string,
): Promise<GroupDeviceSharingState[]> => {
  const devices = await db.$queryRaw<SharingRow[]>(Prisma.sql`
    SELECT ${sharingColumns}
    FROM "UserDevice" AS "device"
    JOIN "User" AS "account" ON "account"."id" = "device"."userId"
    JOIN "GroupMember" AS "member" ON "member"."userId" = "device"."userId"
    WHERE "member"."groupId" = ${groupId}
      AND "device"."revokedAt" IS NULL AND "device"."activatedAt" IS NOT NULL
  `);
  const now = Date.now();
  return devices.map((device) => {
    const sharing = resolveRow(device, now);
    return {
      deviceId: device.deviceId,
      userId: device.userId,
      paused: sharing.paused,
      revisionPrefix: sharing.revisionPrefix,
    };
  });
};

export const getWakeableSharingDeviceIds = async (
  db: SharingDb,
  userId: string,
): Promise<string[]> => {
  const devices = await db.$queryRaw<SharingRow[]>(Prisma.sql`
    SELECT ${sharingColumns}
    FROM "UserDevice" AS "device"
    JOIN "User" AS "account" ON "account"."id" = "device"."userId"
    WHERE "device"."userId" = ${userId}
      AND "device"."revokedAt" IS NULL AND "device"."activatedAt" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "PushToken" WHERE "PushToken"."deviceId" = "device"."id")
      AND EXISTS (
        SELECT 1 FROM "Session"
        WHERE "Session"."deviceId" = "device"."id" AND "Session"."expiresAt" > NOW()
      )
  `);
  const now = Date.now();
  return devices.flatMap((device) => (resolveRow(device, now).paused ? [] : [device.deviceId]));
};
