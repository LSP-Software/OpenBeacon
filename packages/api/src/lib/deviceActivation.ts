import type { DeviceActivation, Prisma } from "@openbeacon/database";
import { devicePendingCause } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";

export class DevicePendingError extends Error {
  constructor() {
    super(devicePendingCause);
    this.name = "DevicePendingError";
  }
}

export const devicePendingError = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Set up this phone before it can see locations.",
    cause: new DevicePendingError(),
  });

export const activateDevice = async ({
  activatedBy,
  db,
  deviceId,
  userId,
}: {
  activatedBy: DeviceActivation;
  db: Pick<Prisma.TransactionClient, "group" | "userDevice">;
  deviceId: string;
  userId: string;
}) => {
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
