import { type Prisma, type PrismaClient, readDatabaseTime } from "@openbeacon/database";
import { decodeBase64, encodeBase64 } from "@openbeacon/encryption";
import type { crashAlertCopySchema } from "@openbeacon/schemas";
import { effectiveNotificationSetting } from "@openbeacon/schemas";
import { resolveLocationSharing } from "@openbeacon/shared";
import type z from "zod";
import { assertActiveDevices } from "./groupWriteChecks.ts";
import { HISTORY_RETENTION_MS } from "./historyShare.ts";
import { decodeAlertsCursor, encodeAlertsCursor } from "./placeTransitions.ts";

const CATCH_UP_OVERLAP_MS = 60_000;
const CATCH_UP_LOOKBACK_MS = 24 * 3_600_000;
const CATCH_UP_LIMIT = 100;
const NONCE_LENGTH = 24;

const crashAlertSelect = {
  id: true,
  groupId: true,
  messageId: true,
  epochId: true,
  senderUserId: true,
  senderDeviceId: true,
  payload: true,
  receivedAt: true,
  senderDevice: { select: { name: true } },
} as const;

const sharingSelect = {
  sharingPaused: true,
  sharingPausedUntil: true,
  sharingChangedAt: true,
  sharingRevision: true,
} as const;

const toCrashAlertView = (
  alert: Prisma.CrashAlertGetPayload<{ select: typeof crashAlertSelect }>,
) => ({
  id: alert.id,
  groupId: alert.groupId,
  messageId: alert.messageId,
  epochId: alert.epochId,
  senderUserId: alert.senderUserId,
  senderDeviceId: alert.senderDeviceId,
  deviceName: alert.senderDevice.name,
  nonce: encodeBase64(alert.payload.subarray(0, NONCE_LENGTH)),
  ciphertext: encodeBase64(alert.payload.subarray(NONCE_LENGTH)),
  receivedAt: alert.receivedAt,
});

export const sendCrashAlerts = async ({
  copies,
  db,
  deviceId,
  userId,
}: {
  copies: z.infer<typeof crashAlertCopySchema>[];
  db: PrismaClient;
  deviceId: string;
  userId: string;
}) =>
  db.$transaction(async (tx) => {
    await assertActiveDevices(tx, { deviceIds: [deviceId], userId });
    const receivedAt = await readDatabaseTime(tx);
    const device = await tx.userDevice.findUniqueOrThrow({
      where: { id: deviceId },
      select: { ...sharingSelect, user: { select: sharingSelect } },
    });
    const groupIds = [...new Set(copies.map(({ groupId }) => groupId))];
    const [memberships, epochs, existing] = await Promise.all([
      tx.groupMember.findMany({
        where: { userId, groupId: { in: groupIds } },
        select: { groupId: true, joinedEpochNumber: true },
      }),
      tx.groupEpoch.findMany({
        where: { id: { in: copies.map(({ epochId }) => epochId) } },
        select: { id: true, groupId: true, epochNumber: true },
      }),
      tx.crashAlert.findMany({
        where: {
          OR: copies.map(({ groupId, messageId }) => ({ groupId, messageId })),
        },
        select: { groupId: true, messageId: true },
      }),
    ]);
    const paused = resolveLocationSharing(device.user, device, receivedAt.getTime()).paused;
    const key = ({ groupId, messageId }: { groupId: string; messageId: string }) =>
      `${groupId}|${messageId}`;
    const stored = new Set(existing.map(key));
    const result = {
      accepted: [] as { groupId: string; messageId: string }[],
      duplicates: [] as { groupId: string; messageId: string }[],
      discarded: [] as { groupId: string; messageId: string }[],
      expired: [] as { groupId: string; messageId: string }[],
      receivedAt,
    };
    const toInsert: Prisma.CrashAlertCreateManyInput[] = [];
    for (const copy of copies) {
      const id = { groupId: copy.groupId, messageId: copy.messageId };
      const member = memberships.find(({ groupId }) => groupId === copy.groupId);
      const epoch = epochs.find(({ id }) => id === copy.epochId);
      if (stored.has(key(copy))) {
        result.duplicates.push(id);
      } else if (paused || !member) {
        result.discarded.push(id);
      } else if (
        !epoch ||
        epoch.groupId !== copy.groupId ||
        epoch.epochNumber < member.joinedEpochNumber
      ) {
        result.expired.push(id);
      } else {
        toInsert.push({
          ...id,
          epochId: copy.epochId,
          senderDeviceId: deviceId,
          senderUserId: userId,
          payload: new Uint8Array([...decodeBase64(copy.nonce), ...decodeBase64(copy.ciphertext)]),
          receivedAt,
        });
      }
    }
    const inserted =
      toInsert.length > 0
        ? await tx.crashAlert.createManyAndReturn({
            data: toInsert,
            skipDuplicates: true,
            select: { id: true, groupId: true, messageId: true },
          })
        : [];
    const insertedKeys = new Set(inserted.map(key));
    for (const copy of toInsert) {
      const id = { groupId: copy.groupId, messageId: copy.messageId };
      (insertedKeys.has(key(id)) ? result.accepted : result.duplicates).push(id);
    }
    return { ...result, rowIds: inserted.map(({ id }) => id) };
  });

export const readCrashAlertsSince = async ({
  cursor,
  db,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  userId: string;
}) => {
  const now = await readDatabaseTime(db);
  const caughtUp = encodeAlertsCursor({ createdAt: now, id: "" });
  if (cursor === null) return { alerts: [], cursor: caughtUp, notify: true };
  const setting = await db.notificationSetting.findUnique({
    where: { userId_type: { userId, type: "CRASH_ALERTS" } },
    select: { email: true, phone: true },
  });
  const notify = effectiveNotificationSetting("CRASH_ALERTS", setting ?? undefined).phone;
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true, createdAt: true },
  });
  if (memberships.length === 0) return { alerts: [], cursor: caughtUp, notify };
  const since = Math.max(
    decodeAlertsCursor(cursor).createdAt.getTime() - CATCH_UP_OVERLAP_MS,
    now.getTime() - CATCH_UP_LOOKBACK_MS,
  );
  const rows = await db.crashAlert.findMany({
    where: {
      senderUserId: { not: userId },
      OR: memberships.map((membership) => ({
        groupId: membership.groupId,
        receivedAt: { gte: new Date(Math.max(since, membership.createdAt.getTime())) },
      })),
    },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: CATCH_UP_LIMIT,
    select: crashAlertSelect,
  });
  const last = rows.at(-1);
  return {
    alerts: rows.map(toCrashAlertView),
    cursor:
      last && rows.length === CATCH_UP_LIMIT
        ? encodeAlertsCursor({
            createdAt: new Date(last.receivedAt.getTime() + CATCH_UP_OVERLAP_MS),
            id: "",
          })
        : caughtUp,
    notify,
  };
};

export const readGroupCrashAlerts = async ({
  db,
  groupId,
  memberSince,
}: {
  db: PrismaClient;
  groupId: string;
  memberSince: Date;
}) => {
  const now = await readDatabaseTime(db);
  const rows = await db.crashAlert.findMany({
    where: {
      groupId,
      receivedAt: {
        gte: new Date(Math.max(now.getTime() - HISTORY_RETENTION_MS, memberSince.getTime())),
      },
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: crashAlertSelect,
  });
  return { alerts: rows.map(toCrashAlertView) };
};
