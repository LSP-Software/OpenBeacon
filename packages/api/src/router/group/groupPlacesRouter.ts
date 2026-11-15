import type { PrismaClient } from "@openbeacon/database";
import { GroupRole, Prisma } from "@openbeacon/database";
import {
  createPlaceSchema,
  deletePlaceSchema,
  listPlacesSchema,
  MAX_PLACES_PER_GROUP,
  PLACE_GEOMETRY_KIND,
  reEncryptPlaceSchema,
  updatePlaceSchema,
} from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import {
  assertActiveDevices,
  lockGroupEpoch,
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
      writePlaces({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometry: input.geometry,
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
              epochId: input.geometry.epochId,
              senderDeviceId: input.geometry.senderDeviceId,
              algorithm: input.geometry.algorithm,
              nonce: input.geometry.nonce,
              ciphertext: input.geometry.ciphertext,
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
      writePlaces({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometry: input.geometry,
        groupId: input.groupId,
        needsAdmin: true,
        userId: ctx.session.user.id,
        write: async (tx) =>
          swapPlace(tx, {
            data: {
              name: input.name,
              emoji: input.emoji,
              updatedByUserId: ctx.session.user.id,
            },
            geometry: input.geometry,
            groupId: input.groupId,
            placeId: input.placeId,
            where: { ciphertext: input.expectedCiphertext },
          }),
      }),
    ),
  reEncrypt: groupMemberProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .input(reEncryptPlaceSchema)
    .mutation(async ({ ctx, input }) =>
      writePlaces({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometry: input.geometry,
        groupId: input.groupId,
        needsAdmin: false,
        userId: ctx.session.user.id,
        write: async (tx, epoch) => {
          if (!epoch?.isLatest) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Places can only be re-encrypted with the group's latest epoch.",
              cause: new ReasonError("EPOCH_NOT_LATEST"),
            });
          }
          return swapPlace(tx, {
            data: {},
            geometry: input.geometry,
            groupId: input.groupId,
            placeId: input.placeId,
            where: { ciphertext: input.expectedCiphertext, name: input.name, emoji: input.emoji },
          });
        },
      }),
    ),
  delete: groupAdminProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(deletePlaceSchema)
    .mutation(async ({ ctx, input }) =>
      writePlaces({
        db: ctx.db,
        deviceId: ctx.deviceId,
        geometry: null,
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

const writePlaces = async <T extends object>({
  db,
  deviceId,
  geometry,
  groupId,
  needsAdmin,
  userId,
  write,
}: {
  db: PrismaClient;
  deviceId: string;
  geometry: z.infer<typeof createPlaceSchema>["geometry"] | null;
  groupId: string;
  needsAdmin: boolean;
  userId: string;
  write: (tx: Prisma.TransactionClient, epoch: { isLatest: boolean } | null) => Promise<T>;
}) => {
  if (geometry && geometry.senderDeviceId !== deviceId) {
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
    let epoch: { isLatest: boolean } | null = null;
    if (geometry) {
      await assertActiveDevices(tx, { deviceIds: [deviceId], userId });
      epoch = await lockGroupEpoch(tx, { epochId: geometry.epochId, groupId });
    }
    const result = await write(tx, epoch);
    const group = await tx.group.update({
      where: { id: groupId },
      data: { placesRevision: { increment: 1 } },
      select: { placesRevision: true },
    });
    return { ...result, placesRevision: group.placesRevision };
  });
};

const swapPlace = async (
  tx: Prisma.TransactionClient,
  {
    data,
    geometry,
    groupId,
    placeId,
    where,
  }: {
    data: { name?: string; emoji?: string; updatedByUserId?: string };
    geometry: z.infer<typeof createPlaceSchema>["geometry"];
    groupId: string;
    placeId: string;
    where: { ciphertext: string; name?: string; emoji?: string };
  },
) => {
  const updated = await tx.place.updateMany({
    where: { ...where, id: placeId, groupId },
    data: {
      ...data,
      epochId: geometry.epochId,
      senderDeviceId: geometry.senderDeviceId,
      algorithm: geometry.algorithm,
      nonce: geometry.nonce,
      ciphertext: geometry.ciphertext,
    },
  });
  if (updated.count === 0) {
    if (!(await tx.place.findFirst({ where: { id: placeId, groupId }, select: { id: true } }))) {
      throw placeGone();
    }
    throw new TRPCError({
      code: "CONFLICT",
      message: "This place changed. Reload and try again.",
      cause: new ReasonError("PLACE_CHANGED"),
    });
  }
  const place = await tx.place.findUniqueOrThrow({ where: { id: placeId }, select: placeSelect });
  return { place: { ...place, kind: PLACE_GEOMETRY_KIND } };
};

const placeGone = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This place no longer exists.",
    cause: new ReasonError("PLACE_GONE"),
  });
