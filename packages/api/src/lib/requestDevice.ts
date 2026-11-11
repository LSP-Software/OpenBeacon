import type { PrismaClient } from "@openbeacon/database";

export const linkRequestDevice = async ({
  db,
  deviceId,
  sessionId,
  userId,
  now = new Date(),
}: {
  db: Pick<PrismaClient, "session" | "userDevice">;
  deviceId: string;
  sessionId: string;
  userId: string;
  now?: Date;
}) => {
  if (deviceId.length > 128) return null;
  const device = await db.userDevice.findFirst({
    where: { id: deviceId, userId },
    select: { lastSeenAt: true, sessions: { where: { id: sessionId }, select: { id: true } } },
  });
  if (!device) return null;
  const lastSeenBefore = new Date(now.getTime() - 5 * 60_000);
  await Promise.all([
    device.sessions.length === 0 &&
      db.session.updateMany({ where: { id: sessionId, deviceId: null }, data: { deviceId } }),
    device.lastSeenAt <= lastSeenBefore &&
      db.userDevice.updateMany({
        where: { id: deviceId, lastSeenAt: { lte: lastSeenBefore } },
        data: { lastSeenAt: now },
      }),
  ]);
  return deviceId;
};
