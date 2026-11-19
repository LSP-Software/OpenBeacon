import { type DeviceActivation, Prisma } from "@openbeacon/database";
import { devicePendingCause } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { deviceRemovedError } from "./deviceRemoved.ts";
import { limits } from "./limits.ts";
import { lockUserGroups } from "./lockUserGroups.ts";
import { ReasonError } from "./reasonError.ts";
import { lockAccounts } from "./seats.ts";

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

export const deviceLimitError = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Your account already has ${limits.devicesPerAccount} phones set up. Remove one in Account › Devices to set up this one.`,
    cause: new ReasonError("DEVICE_LIMIT"),
  });

export const countActivatedDevices = (
  db: Pick<Prisma.TransactionClient, "userDevice">,
  userId: string,
) => db.userDevice.count({ where: { userId, activatedAt: { not: null }, revokedAt: null } });

export const lockActivatingAccount = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw" | "group">,
  userId: string,
) => {
  const owners = await db.group.findMany({
    where: { groupMembers: { some: { userId } } },
    select: { ownerId: true },
  });
  await lockAccounts(db, [userId, ...owners.map(({ ownerId }) => ownerId)]);
};

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
  const pending = await db.userDevice.findFirst({
    select: { id: true },
    where: { id: deviceId, userId, activatedAt: null, revokedAt: null },
  });
  if (!pending) return false;
  if ((await countActivatedDevices(db, userId)) >= limits.devicesPerAccount) {
    throw deviceLimitError();
  }
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
