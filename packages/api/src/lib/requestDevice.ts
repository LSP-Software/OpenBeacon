import type { PrismaClient } from "@openbeacon/database";

export const linkRequestDevice = async ({
  db,
  deviceId,
  session,
  now = new Date(),
}: {
  db: Pick<PrismaClient, "session" | "userDevice">;
  deviceId: string;
  session: { id: string; userId: string } | null;
  now?: Date;
}): Promise<
  { removed: true } | { removed: false; deviceId: string | null; unverifiedDeviceId: string | null }
> => {
  const unknown = { removed: false as const, deviceId: null, unverifiedDeviceId: null };
  if (deviceId.length > 128) return unknown;
  const device = await db.userDevice.findUnique({
    where: { id: deviceId },
    select: { userId: true, lastSeenAt: true, revokedAt: true },
  });
  if (!device || (session && device.userId !== session.userId)) return unknown;
  if (device.revokedAt) {
    if (session) await db.session.deleteMany({ where: { id: session.id } });
    return { removed: true };
  }
  if (!session) return unknown;
  const current = await db.session.findUnique({
    where: { id: session.id },
    select: { deviceId: true },
  });
  if (current?.deviceId !== deviceId) {
    return { ...unknown, unverifiedDeviceId: current?.deviceId === null ? deviceId : null };
  }
  const lastSeenBefore = new Date(now.getTime() - 5 * 60_000);
  if (device.lastSeenAt <= lastSeenBefore) {
    await db.userDevice.updateMany({
      where: { id: deviceId, lastSeenAt: { lte: lastSeenBefore } },
      data: { lastSeenAt: now },
    });
  }
  return { removed: false, deviceId, unverifiedDeviceId: null };
};
