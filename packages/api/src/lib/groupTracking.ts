import { Prisma } from "@openbeacon/database";
import type { groupTrackingPointSchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import { getGroupSharingStates } from "./locationSharing.ts";

type GroupTrackingDb = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  groupEncryptedPayload: {
    createMany: (args: {
      data: Array<{
        algorithm: string;
        ciphertext: string;
        clientPointId: string;
        epochId: string;
        groupId: string;
        kind: string;
        nonce: string;
        senderDeviceId: string;
        senderUserId: string;
      }>;
      skipDuplicates: boolean;
    }) => Promise<{ count: number }>;
    findMany: (args: {
      orderBy?: Array<{ createdAt: "asc" } | { id: "asc" }>;
      select: {
        algorithm?: true;
        ciphertext?: true;
        clientPointId: true;
        createdAt?: true;
        epochId?: true;
        id?: true;
        kind?: true;
        nonce?: true;
        senderDeviceId?: true;
        senderUserId?: true;
      };
      take?: number;
      where: {
        AND?: Array<Record<string, unknown>>;
        clientPointId?: { in: string[] };
        groupId: string;
        OR?: Array<Record<string, unknown>>;
      };
    }) => Promise<
      Array<{
        algorithm?: string;
        ciphertext?: string;
        clientPointId: string;
        createdAt?: Date;
        epochId?: string;
        id?: string;
        kind?: string;
        nonce?: string;
        senderDeviceId?: string;
        senderUserId?: string;
      }>
    >;
  };
  groupEpoch: {
    count: (args: { where: { id: { in: string[] } } }) => Promise<number>;
    findMany: (args: {
      select: { id: true };
      where: { groupId: string; id: { in: string[] }; createdAt?: { gte: Date } };
    }) => Promise<Array<{ id: string }>>;
  };
  userDevice: {
    updateMany: (args: {
      data: { lastLocationAt: Date };
      where: { id: { in: string[] }; userId: string };
    }) => Promise<{ count: number }>;
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

export type GroupEncryptedPayloadRow = {
  algorithm: string;
  ciphertext: string;
  clientPointId: string;
  createdAt: Date;
  epochId: string;
  id: string;
  kind: string;
  nonce: string;
  senderDeviceId: string;
  senderUserId: string;
};

export const uploadGroupTrackingBatch = async ({
  db,
  groupId,
  memberSince,
  points,
  userId,
}: {
  db: GroupTrackingDb;
  groupId: string;
  memberSince?: Date;
  points: z.infer<typeof groupTrackingPointSchema>[];
  userId: string;
}) => {
  const clientPointIds = points.map((point) => point.clientPointId);
  if (new Set(clientPointIds).size !== clientPointIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Duplicate clientPointId values in upload batch.",
    });
  }

  const senderDeviceIds = [...new Set(points.map((point) => point.senderDeviceId))];
  const epochIds = [...new Set(points.map((point) => point.epochId))];

  const [devices, epochs, existingRows] = await Promise.all([
    db.userDevice.findMany({
      select: {
        id: true,
        userId: true,
      },
      where: {
        id: { in: senderDeviceIds },
        revokedAt: null,
        activatedAt: { not: null },
        userId,
      },
    }),
    db.groupEpoch.findMany({
      select: {
        id: true,
      },
      where: {
        groupId,
        id: { in: epochIds },
        ...(memberSince ? { createdAt: { gte: memberSince } } : {}),
      },
    }),
    db.groupEncryptedPayload.findMany({
      select: {
        clientPointId: true,
      },
      where: {
        clientPointId: { in: clientPointIds },
        groupId,
      },
    }),
  ]);

  if (devices.length !== senderDeviceIds.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The active device is not registered.",
    });
  }

  const foundEpochIds = new Set(epochs.map((epoch) => epoch.id));
  const missingEpochIds = epochIds.filter((epochId) => !foundEpochIds.has(epochId));
  if (
    missingEpochIds.length > 0 &&
    (await db.groupEpoch.count({ where: { id: { in: missingEpochIds } } })) > 0
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Epoch does not belong to this group.",
    });
  }

  const existingClientPointIds = new Set(existingRows.map((row) => row.clientPointId));
  const sharing = await getGroupSharingStates(db, groupId);
  const discarded = points.filter((point) => {
    if (existingClientPointIds.has(point.clientPointId) || !foundEpochIds.has(point.epochId)) {
      return false;
    }
    const state = sharing.find(
      (device) => device.deviceId === point.senderDeviceId && device.userId === userId,
    );
    return !state || state.paused || !point.clientPointId.startsWith(state.revisionPrefix);
  });
  const discardedIds = new Set(discarded.map((point) => point.clientPointId));
  const pointsToInsert = points.filter(
    (point) =>
      foundEpochIds.has(point.epochId) &&
      !existingClientPointIds.has(point.clientPointId) &&
      !discardedIds.has(point.clientPointId),
  );

  if (pointsToInsert.length > 0) {
    await db.groupEncryptedPayload.createMany({
      data: pointsToInsert.map((point) => ({
        algorithm: point.algorithm,
        ciphertext: point.ciphertext,
        clientPointId: point.clientPointId,
        epochId: point.epochId,
        groupId,
        kind: point.kind,
        nonce: point.nonce,
        senderDeviceId: point.senderDeviceId,
        senderUserId: userId,
      })),
      skipDuplicates: true,
    });
    await db.userDevice.updateMany({
      data: { lastLocationAt: new Date() },
      where: {
        id: { in: [...new Set(pointsToInsert.map((point) => point.senderDeviceId))] },
        userId,
      },
    });
  }

  return {
    accepted: pointsToInsert.map((point) => point.clientPointId),
    discarded: [...discardedIds],
    duplicates: points
      .filter((point) => existingClientPointIds.has(point.clientPointId))
      .map((point) => point.clientPointId),
    expired: points
      .filter((point) => !foundEpochIds.has(point.epochId))
      .map((point) => point.clientPointId),
  };
};

export const pollGroupTrackingPoints = async ({
  cursor,
  db,
  groupId,
  limit,
}: {
  cursor: { createdAt: Date; id: string } | null | undefined;
  db: GroupTrackingDb;
  groupId: string;
  limit: number;
}) => {
  const points = await db.groupEncryptedPayload.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      algorithm: true,
      ciphertext: true,
      clientPointId: true,
      createdAt: true,
      epochId: true,
      id: true,
      kind: true,
      nonce: true,
      senderDeviceId: true,
      senderUserId: true,
    },
    take: limit,
    where: {
      groupId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              {
                AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.id } }],
              },
            ],
          }
        : {}),
    },
  });

  const sharing = await getGroupSharingStates(db, groupId);
  const last = points.at(-1);
  return {
    points: (points as GroupEncryptedPayloadRow[]).filter((point) =>
      sharing.some(
        (device) =>
          device.deviceId === point.senderDeviceId &&
          device.userId === point.senderUserId &&
          !device.paused &&
          point.clientPointId.startsWith(device.revisionPrefix),
      ),
    ),
    sharing,
    cursor: last?.createdAt && last.id ? { createdAt: last.createdAt, id: last.id } : null,
    hasMore: points.length === limit,
  };
};

export const getLatestGroupTrackingPoints = async ({
  db,
  groupId,
}: {
  db: GroupTrackingDb;
  groupId: string;
}) => {
  const points = await db.$queryRaw<GroupEncryptedPayloadRow[]>(Prisma.sql`
    SELECT
      "latest"."id",
      "latest"."epochId",
      "latest"."senderDeviceId",
      "latest"."senderUserId",
      "latest"."kind",
      "latest"."algorithm",
      "latest"."nonce",
      "latest"."ciphertext",
      "latest"."clientPointId",
      "latest"."createdAt"
    FROM "GroupMember" AS "member"
    JOIN "UserDevice" AS "device"
      ON "device"."userId" = "member"."userId"
      AND "device"."revokedAt" IS NULL
      AND "device"."activatedAt" IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT *
      FROM "GroupEncryptedPayload" AS "point"
      WHERE "point"."groupId" = "member"."groupId"
        AND "point"."senderDeviceId" = "device"."id"
        AND "point"."senderUserId" = "member"."userId"
      ORDER BY "point"."createdAt" DESC, "point"."id" DESC
      LIMIT 1
    ) AS "latest"
    WHERE "member"."groupId" = ${groupId}
    ORDER BY "latest"."senderUserId" ASC, "latest"."senderDeviceId" ASC
  `);

  const sharing = await getGroupSharingStates(db, groupId);
  return {
    points: points.filter((point) =>
      sharing.some(
        (device) =>
          device.deviceId === point.senderDeviceId &&
          device.userId === point.senderUserId &&
          !device.paused &&
          point.clientPointId.startsWith(device.revisionPrefix),
      ),
    ),
    sharing,
  };
};
