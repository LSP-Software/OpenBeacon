import { type DeviceActivation, Prisma } from "@openbeacon/database";
import { devicePendingCause } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { deviceRemovedError } from "./deviceRemoved.ts";
import { lockUserGroups } from "./lockUserGroups.ts";
import { ReasonError } from "./reasonError.ts";

export class DevicePendingError extends ReasonError {
  constructor() {
    super(devicePendingCause);
    this.name = "DevicePendingError";
  }
}

export const devicePendingError = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Finish setting up this phone first.",
    cause: new DevicePendingError(),
  });

export const activateDevice = async ({
  activatedBy,
  db,
  deviceId,
  userId,
}: {
  activatedBy: DeviceActivation;
  db: Pick<Prisma.TransactionClient, "$queryRaw" | "group" | "groupMember" | "userDevice">;
  deviceId: string;
  userId: string;
}) => {
  await lockUserGroups(db, userId);
  const activated = await db.userDevice.updateMany({
    data: { activatedAt: new Date(), activatedBy },
    where: { id: deviceId, userId, activatedAt: null, revokedAt: null },
  });
  if (activated.count === 0) return false;
  await db.group.updateMany({
    data: { epochRotationRequired: true },
    where: { groupMembers: { some: { userId } } },
  });
  return true;
};

export const lockThisDevice = async ({
  db,
  deviceId,
  userId,
}: {
  db: Pick<Prisma.TransactionClient, "$queryRaw" | "userDevice">;
  deviceId: string;
  userId: string;
}) => {
  await db.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`);
  const device = await db.userDevice.findFirst({
    select: { activatedAt: true, revokedAt: true },
    where: { id: deviceId, userId },
  });
  if (!device) {
    throw new TRPCError({ code: "NOT_FOUND", message: "This phone isn't registered yet." });
  }
  if (device.revokedAt) throw deviceRemovedError();
  return { active: device.activatedAt !== null };
};
