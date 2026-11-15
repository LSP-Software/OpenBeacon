import type { PrismaClient } from "@openbeacon/database";
import { GroupRole, Prisma } from "@openbeacon/database";
import {
  createPlaceSchema,
  deletePlaceSchema,
  listPlacesSchema,
  MAX_PLACES_PER_GROUP,
  PLACE_GEOMETRY_KIND,
  reEncryptPlacesSchema,
  updatePlaceSchema,
} from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import {
  assertActiveDevices,
  assertLatestGroupEpoch,
  lockGroupMemberForWrite,
} from "../../lib/groupWriteChecks.ts";
import { ReasonError } from "../../lib/reasonError.ts";
import { groupAdminProcedure, groupMemberProcedure } from "../../procedures/auth/group.ts";

const placeSelect = {
  id: true,
  name: true,
  emoji: true,
  epochId: true,
  senderDeviceId: true,
  algorithm: true,
  nonce: true,
  ciphertext: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const groupPlacesRouter = {
  list: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(listPlacesSchema)
    .query(async ({ ctx, input }) => {
      const [group, latestEpoch, places] = await ctx.db.$transaction(
        [
          ctx.db.group.findUnique({
            where: { id: input.groupId },
            select: { placesRevision: true },
          }),
          ctx.db.groupEpoch.findFirst({
            where: { groupId: input.groupId },
            orderBy: { epochNumber: "desc" },
            select: { id: true },
          }),
          ctx.db.place.findMany({
            where: { groupId: input.groupId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: placeSelect,
          }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return {
        latestEpochId: latestEpoch?.id ?? null,
        placesRevision: group?.placesRevision ?? 0,
        places: places.map((place) => ({ ...place, kind: PLACE_GEOMETRY_KIND })),
      };
    }),
  create: groupAdminProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(createPlaceSchema)
    .mutation(async ({ ctx, input }) =>
      writePlace({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometries: [input.geometry],
        groupId: input.groupId,
        needsAdmin: true,
        userId: ctx.session.user.id,
        write: async (tx) => {
          if (
            (await tx.place.count({ where: { groupId: input.groupId } })) >= MAX_PLACES_PER_GROUP
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `A group can have at most ${MAX_PLACES_PER_GROUP} places.`,
              cause: new ReasonError("PLACE_LIMIT_REACHED"),
            });
          }
          const place = await tx.place.create({
            data: {
              groupId: input.groupId,
              name: input.name,
              emoji: input.emoji,
              ...geometryColumns(input.geometry),
              createdByUserId: ctx.session.user.id,
            },
            select: placeSelect,
          });
          return { place: { ...place, kind: PLACE_GEOMETRY_KIND } };
        },
      }),
    ),
  update: groupAdminProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(updatePlaceSchema)
    .mutation(async ({ ctx, input }) =>
      writePlace({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometries: [input.geometry],
        groupId: input.groupId,
        needsAdmin: true,
        userId: ctx.session.user.id,
        write: async (tx) => {
          const updated = await tx.place.updateMany({
            where: {
              id: input.placeId,
              groupId: input.groupId,
              ciphertext: input.expectedCiphertext,
            },
            data: {
              name: input.name,
              emoji: input.emoji,
              updatedByUserId: ctx.session.user.id,
              ...geometryColumns(input.geometry),
            },
          });
          if (updated.count === 0) {
            const exists = await tx.place.findFirst({
              where: { id: input.placeId, groupId: input.groupId },
              select: { id: true },
            });
            if (!exists) throw placeGone();
            throw new TRPCError({
              code: "CONFLICT",
              message: "This place changed. Reload and try again.",
              cause: new ReasonError("PLACE_CHANGED"),
            });
          }
          const place = await tx.place.findUniqueOrThrow({
            where: { id: input.placeId },
            select: placeSelect,
          });
          return { place: { ...place, kind: PLACE_GEOMETRY_KIND } };
        },
      }),
    ),
  reEncrypt: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(reEncryptPlacesSchema)
    .mutation(async ({ ctx, input }) =>
      writePlace({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometries: input.places.map(({ geometry }) => geometry),
        groupId: input.groupId,
        needsAdmin: false,
        userId: ctx.session.user.id,
        write: async (tx) => {
          const requests = [...input.places].sort((a, b) => (a.placeId < b.placeId ? -1 : 1));
          const stored = await tx.place.findMany({
            where: { id: { in: requests.map(({ placeId }) => placeId) }, groupId: input.groupId },
            select: { id: true, name: true, emoji: true, epochId: true, ciphertext: true },
          });
          const storedById = new Map(stored.map((place) => [place.id, place]));
          const reEncrypted: string[] = [];
          const skipped: string[] = [];
          const changed: string[] = [];
          const gone: string[] = [];
          for (const request of requests) {
            const place = storedById.get(request.placeId);
            if (!place) {
              gone.push(request.placeId);
            } else if (place.epochId === request.geometry.epochId) {
              skipped.push(request.placeId);
            } else if (
              place.ciphertext !== request.expectedCiphertext ||
              place.name !== request.name ||
              place.emoji !== request.emoji
            ) {
              changed.push(request.placeId);
            } else {
              await tx.place.update({
                where: { id: place.id },
                data: geometryColumns(request.geometry),
              });
              reEncrypted.push(place.id);
            }
          }
          const places = await tx.place.findMany({
            where: { id: { in: reEncrypted } },
            orderBy: { id: "asc" },
            select: placeSelect,
          });
          return {
            places: places.map((place) => ({ ...place, kind: PLACE_GEOMETRY_KIND })),
            skipped,
            changed,
            gone,
          };
        },
        changesPlaces: (result) => result.places.length > 0,
      }),
    ),
  delete: groupAdminProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(deletePlaceSchema)
    .mutation(async ({ ctx, input }) =>
      writePlace({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometries: [],
        groupId: input.groupId,
        needsAdmin: true,
        userId: ctx.session.user.id,
        write: async (tx) => {
          const deleted = await tx.place.deleteMany({
            where: { id: input.placeId, groupId: input.groupId },
          });
          if (deleted.count === 0) throw placeGone();
          return {};
        },
      }),
    ),
} satisfies TRPCRouterRecord;

type PlaceGeometry = z.infer<typeof createPlaceSchema>["geometry"];

const geometryColumns = (geometry: PlaceGeometry) => ({
  epochId: geometry.epochId,
  senderDeviceId: geometry.senderDeviceId,
  algorithm: geometry.algorithm,
  nonce: geometry.nonce,
  ciphertext: geometry.ciphertext,
});

const writePlace = async <T extends object>({
  changesPlaces = () => true,
  db,
  deviceId,
  geometries,
  groupId,
  needsAdmin,
  userId,
  write,
}: {
  changesPlaces?: (result: T) => boolean;
  db: PrismaClient;
  deviceId: string;
  geometries: PlaceGeometry[];
  groupId: string;
  needsAdmin: boolean;
  userId: string;
  write: (tx: Prisma.TransactionClient) => Promise<T>;
}) => {
  if (geometries.some((geometry) => geometry.senderDeviceId !== deviceId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Places must be sent from this device.",
      cause: new ReasonError("DEVICE_NOT_REGISTERED"),
    });
  }
  return await db.$transaction(async (tx) => {
    const member = await lockGroupMemberForWrite(tx, {
      groupId,
      groupLock: "FOR NO KEY UPDATE",
      userId,
    });
    if (needsAdmin && member.role !== GroupRole.OWNER && member.role !== GroupRole.ADMIN) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not an admin of this group" });
    }
    await assertActiveDevices(tx, { deviceIds: [deviceId], userId });
    if (geometries.length > 0) {
      await assertLatestGroupEpoch(tx, {
        epochIds: [...new Set(geometries.map(({ epochId }) => epochId))],
        groupId,
      });
    }
    const result = await write(tx);
    const group = changesPlaces(result)
      ? await tx.group.update({
          where: { id: groupId },
          data: { placesRevision: { increment: 1 } },
          select: { placesRevision: true },
        })
      : await tx.group.findUniqueOrThrow({
          where: { id: groupId },
          select: { placesRevision: true },
        });
    return { ...result, placesRevision: group.placesRevision };
  });
};

const placeGone = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This place no longer exists.",
    cause: new ReasonError("PLACE_GONE"),
  });
