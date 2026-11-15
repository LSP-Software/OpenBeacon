import type { Prisma, PrismaClient } from "@openbeacon/database";
import type { placeTransitionSchema } from "@openbeacon/schemas";
import { resolveLocationSharing } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import { assertActiveDevices } from "./groupWriteChecks.ts";
import { ReasonError } from "./reasonError.ts";

export const PLACE_TRANSITION_RETENTION_MS = 14 * 24 * 60 * 60_000;

const placeTransitionSelect = {
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

const toPlaceTransitionView = (
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
  if (transitions.some((transition) => transition.senderDeviceId !== deviceId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Place transitions must be sent from this device.",
      cause: new ReasonError("DEVICE_NOT_REGISTERED"),
    });
  }
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
    select: { enabled: true },
  });
  const places = await db.place.findMany({
    where: { groupId, id: { in: [...new Set(transitions.map(({ placeId }) => placeId))] } },
    select: { id: true },
  });

  const duplicateIds = new Set(existing.map(({ clientId }) => clientId));
  const placeIds = new Set(places.map(({ id }) => id));
  const sharing = resolveLocationSharing(device.user, device, now.getTime());
  const earliest = Math.max(
    now.getTime() - PLACE_TRANSITION_RETENTION_MS,
    memberSince.getTime(),
    sharing.resumeAfter?.getTime() ?? 0,
  );
  const latest = now.getTime() + 5 * 60_000;
  const fresh = transitions.filter(({ clientId }) => !duplicateIds.has(clientId));
  const toInsert =
    sharing.paused || placeSharing?.enabled === false
      ? []
      : fresh.filter(
          ({ occurredAt, placeId }) =>
            placeIds.has(placeId) &&
            occurredAt.getTime() >= earliest &&
            occurredAt.getTime() <= latest,
        );
  if (toInsert.length > 0) {
    await db.placeTransition.createMany({
      data: toInsert.map((transition) => ({
        placeId: transition.placeId,
        groupId,
        deviceId,
        userId,
        direction: transition.direction,
        occurredAt: transition.occurredAt,
        clientId: transition.clientId,
        createdAt: now,
      })),
      skipDuplicates: true,
    });
  }
  const insertedIds = new Set(toInsert.map(({ clientId }) => clientId));
  return {
    accepted: [...insertedIds],
    duplicates: [...duplicateIds],
    discarded: fresh
      .filter(({ clientId }) => !insertedIds.has(clientId))
      .map(({ clientId }) => clientId),
  };
};

export const encodePlaceAlertsCursor = ({ createdAt, id }: { createdAt: Date; id: string }) =>
  `${createdAt.toISOString()}|${id}`;

export const readPlaceAlerts = async ({
  cursor,
  db,
  now,
  userId,
}: {
  cursor: string | null;
  db: PrismaClient;
  now: Date;
  userId: string;
}) => {
  const settledBefore = new Date(now.getTime() - 15_000);
  const oldestAlert = now.getTime() - 24 * 60 * 60_000;
  if (cursor === null) {
    return { alerts: [], cursor: encodePlaceAlertsCursor({ createdAt: settledBefore, id: "" }) };
  }
  const separator = cursor.indexOf("|");
  const after = {
    createdAt: new Date(cursor.slice(0, separator)),
    id: cursor.slice(separator + 1),
  };
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true, createdAt: true },
  });
  if (memberships.length === 0) return { alerts: [], cursor };
  const rows = await db.placeTransition.findMany({
    where: {
      userId: { not: userId },
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
  return {
    alerts: rows.map(toPlaceTransitionView),
    cursor: last ? encodePlaceAlertsCursor(last) : cursor,
  };
};

export const readPlacesSummary = async ({ db, userId }: { db: PrismaClient; userId: string }) => {
  const groups = await db.group.findMany({
    where: { groupMembers: { some: { userId } }, places: { some: {} } },
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
  const since = Math.max(now.getTime() - PLACE_TRANSITION_RETENTION_MS, memberSince.getTime());
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
