import { noticeLookbackMs, noticeSettleMs } from "@openbeacon/auth/push.ts";
import { type Prisma, type PrismaClient, readDatabaseTime } from "@openbeacon/database";
import type { placeTransitionSchema } from "@openbeacon/schemas";
import { effectiveNotificationSetting } from "@openbeacon/schemas";
import { resolveLocationSharing } from "@openbeacon/shared";
import type z from "zod";
import { assertActiveDevices } from "./groupWriteChecks.ts";
import { historyRetentionMs } from "./limits.ts";

export const placeTransitionSelect = {
  id: true,
  groupId: true,
  placeId: true,
  direction: true,
  occurredAt: true,
  userId: true,
  deviceId: true,
  createdAt: true,
  place: { select: { name: true, emoji: true } },
  device: { select: { name: true } },
} as const;

const sharingPreferenceSelect = {
  sharingPaused: true,
  sharingPausedUntil: true,
  sharingChangedAt: true,
  sharingRevision: true,
} as const;

export const toPlaceTransitionView = (
  transition: Prisma.PlaceTransitionGetPayload<{ select: typeof placeTransitionSelect }>,
) => ({
  id: transition.id,
  groupId: transition.groupId,
  placeId: transition.placeId,
  placeName: transition.place.name,
  placeEmoji: transition.place.emoji,
  direction: transition.direction,
  occurredAt: transition.occurredAt,
  userId: transition.userId,
  deviceId: transition.deviceId,
  deviceName: transition.device.name,
});

export const uploadPlaceTransitions = async ({
  db,
  deviceId,
  groupId,
  memberSince,
  now,
  transitions,
  userId,
}: {
  db: Prisma.TransactionClient;
  deviceId: string;
  groupId: string;
  memberSince: Date;
  now: Date;
  transitions: z.infer<typeof placeTransitionSchema>[];
  userId: string;
}) => {
  await assertActiveDevices(db, { deviceIds: [deviceId], userId });

  const existing = await db.placeTransition.findMany({
    where: { deviceId, clientId: { in: transitions.map(({ clientId }) => clientId) } },
    select: { clientId: true },
  });
  const device = await db.userDevice.findUniqueOrThrow({
    where: { id: deviceId },
    select: { ...sharingPreferenceSelect, user: { select: sharingPreferenceSelect } },
  });
  const placeSharing = await db.placeSharing.findUnique({
    where: { deviceId_groupId: { deviceId, groupId } },
    select: { enabled: true, updatedAt: true },
  });
  const places = await db.place.findMany({
    where: { groupId, id: { in: [...new Set(transitions.map(({ placeId }) => placeId))] } },
    select: { id: true },
  });

  const existingIds = new Set(existing.map(({ clientId }) => clientId));
  const placeIds = new Set(places.map(({ id }) => id));
  const sharing = resolveLocationSharing(device.user, device, now.getTime());
  const earliest = Math.max(
    now.getTime() - historyRetentionMs,
    memberSince.getTime(),
    sharing.resumeAfter?.getTime() ?? 0,
    placeSharing?.updatedAt.getTime() ?? 0,
  );
  const latest = now.getTime() + 5 * 60_000;
  const fresh = transitions.filter(({ clientId }) => !existingIds.has(clientId));
  const toInsert =
    sharing.paused || placeSharing?.enabled === false
      ? []
      : fresh.filter(
          ({ occurredAt, placeId, senderDeviceId }) =>
            senderDeviceId === deviceId &&
            placeIds.has(placeId) &&
            occurredAt.getTime() >= earliest &&
            occurredAt.getTime() <= latest,
        );
  const createdAt = toInsert.length > 0 ? await readDatabaseTime(db) : now;
  const inserted =
    toInsert.length > 0
      ? await db.placeTransition.createManyAndReturn({
          data: toInsert.map((transition) => ({
            placeId: transition.placeId,
            groupId,
            deviceId,
            userId,
            direction: transition.direction,
            occurredAt: transition.occurredAt,
            clientId: transition.clientId,
            createdAt,
          })),
          skipDuplicates: true,
          select: { clientId: true },
        })
      : [];
  const insertedIds = new Set(inserted.map(({ clientId }) => clientId));
  const attemptedIds = new Set(toInsert.map(({ clientId }) => clientId));
  return {
    accepted: [...insertedIds],
    duplicates: [
      ...existingIds,
      ...[...attemptedIds].filter((clientId) => !insertedIds.has(clientId)),
    ],
    discarded: fresh
      .filter(({ clientId }) => !attemptedIds.has(clientId))
      .map(({ clientId }) => clientId),
  };
};

export const encodeAlertsCursor = ({ createdAt, id }: { createdAt: Date; id: string }) =>
  `${createdAt.toISOString()}|${id}`;

export const decodeAlertsCursor = (cursor: string) => {
  const separator = cursor.indexOf("|");
  return { createdAt: new Date(cursor.slice(0, separator)), id: cursor.slice(separator + 1) };
};

export const readPlaceAlerts = async ({
  cursor,
  db,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  userId: string;
}) => {
  const now = await readDatabaseTime(db);
  const settledBefore = new Date(now.getTime() - noticeSettleMs);
  const oldestAlert = now.getTime() - noticeLookbackMs;
  if (cursor === null) {
    return { alerts: [], cursor: encodeAlertsCursor({ createdAt: settledBefore, id: "" }) };
  }
  const after = decodeAlertsCursor(cursor);
  const caughtUp =
    settledBefore > after.createdAt
      ? encodeAlertsCursor({ createdAt: settledBefore, id: "" })
      : cursor;
  const placeAlertsSetting = await db.notificationSetting.findUnique({
    where: { userId_type: { userId, type: "PLACE_ALERTS" } },
    select: { email: true, phone: true },
  });
  if (!effectiveNotificationSetting("PLACE_ALERTS", placeAlertsSetting ?? undefined).phone) {
    return { alerts: [], cursor: caughtUp };
  }
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true, createdAt: true },
  });
  if (memberships.length === 0) return { alerts: [], cursor };
  const mutes = await db.placeAlertMute.findMany({
    where: { muterUserId: userId },
    select: { placeId: true, mutedUserId: true },
  });
  const rows = await db.placeTransition.findMany({
    where: {
      userId: { not: userId },
      ...(mutes.length > 0
        ? {
            NOT: {
              OR: mutes.map(({ placeId, mutedUserId }) =>
                mutedUserId === null ? { placeId } : { placeId, userId: mutedUserId },
              ),
            },
          }
        : {}),
      createdAt: { gte: after.createdAt, lt: settledBefore },
      AND: [
        {
          OR: memberships.map((membership) => ({
            groupId: membership.groupId,
            occurredAt: {
              gte: new Date(Math.max(membership.createdAt.getTime(), oldestAlert)),
            },
          })),
        },
        { OR: [{ createdAt: { gt: after.createdAt } }, { id: { gt: after.id } }] },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
    select: placeTransitionSelect,
  });
  const last = rows.at(-1);
  if (last && rows.length === 50) {
    return { alerts: rows.map(toPlaceTransitionView), cursor: encodeAlertsCursor(last) };
  }
  return {
    alerts: rows.map(toPlaceTransitionView),
    cursor: caughtUp,
  };
};

export const readPlacesSummary = async ({ db, userId }: { db: PrismaClient; userId: string }) => {
  const groups = await db.group.findMany({
    where: {
      groupMembers: { some: { userId } },
      OR: [{ placesRevision: { gt: 0 } }, { places: { some: {} } }],
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      placesRevision: true,
      groupEpochs: { orderBy: { epochNumber: "desc" }, take: 1, select: { id: true } },
      places: { select: { epochId: true } },
    },
  });
  return groups.map((group) => ({
    groupId: group.id,
    revision: group.placesRevision,
    needsCatchUp: group.places.some(({ epochId }) => epochId !== group.groupEpochs[0]?.id),
  }));
};

export const readRecentPlaceTransitions = async ({
  before,
  db,
  groupId,
  memberSince,
  now,
}: {
  before: { occurredAt: Date; id: string } | undefined;
  db: PrismaClient;
  groupId: string;
  memberSince: Date;
  now: Date;
}) => {
  const limit = 100;
  const since = Math.max(now.getTime() - historyRetentionMs, memberSince.getTime());
  const rows = await db.placeTransition.findMany({
    where: {
      groupId,
      occurredAt: { gte: new Date(since), ...(before ? { lte: before.occurredAt } : {}) },
      ...(before
        ? { OR: [{ occurredAt: { lt: before.occurredAt } }, { id: { lt: before.id } }] }
        : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit,
    select: placeTransitionSelect,
  });
  const last = rows.at(-1);
  return {
    transitions: rows.map(toPlaceTransitionView),
    nextBefore: rows.length === limit && last ? { occurredAt: last.occurredAt, id: last.id } : null,
  };
};
