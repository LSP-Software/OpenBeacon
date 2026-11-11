import { Prisma, type PrismaClient } from "@openbeacon/database";
import type { AlertDevice } from "@openbeacon/email";
import { devicePlatformSchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import { lockUserGroups } from "./lockUserGroups.ts";

export const toAlertDevice = (device: {
  name: string;
  model: string | null;
  platform: string | null;
}): AlertDevice => ({
  name: device.name,
  model: device.model,
  platform: devicePlatformSchema.safeParse(device.platform).data ?? null,
});

export const removeUserDevice = async ({
  db,
  deviceId,
  userId,
  currentSessionId,
  current,
  pendingOnly = false,
}: {
  db: Pick<PrismaClient, "$transaction">;
  deviceId: string;
  userId: string;
  currentSessionId: string;
  current: boolean;
  pendingOnly?: boolean;
}) =>
  db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`);
    await lockUserGroups(tx, userId);
    const device = await tx.userDevice.findFirst({
      where: { id: deviceId, userId, revokedAt: null },
      select: { name: true, model: true, platform: true, activatedAt: true },
    });
    const currentSession = await tx.session.findFirst({
      where: { id: currentSessionId, userId },
      select: { deviceId: true },
    });
    if (!device || !currentSession) {
      throw new TRPCError({ code: "NOT_FOUND", message: "This device has already been removed." });
    }
    if (pendingOnly && device.activatedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This phone has already been set up. Remove it from your devices if it isn't yours.",
      });
    }
    if (!current && currentSession.deviceId === deviceId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "To remove this phone, sign out and choose to remove it.",
      });
    }
    await tx.userDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    await tx.deviceLink.deleteMany({ where: { deviceId } });
    await tx.session.deleteMany({
      where: {
        userId,
        OR: [
          { deviceId },
          current ? { id: currentSessionId } : { deviceId: null, id: { not: currentSessionId } },
        ],
      },
    });
    await tx.group.updateMany({
      data: { epochRotationRequired: true },
      where: { groupMembers: { some: { userId } } },
    });
    return toAlertDevice(device);
  });
