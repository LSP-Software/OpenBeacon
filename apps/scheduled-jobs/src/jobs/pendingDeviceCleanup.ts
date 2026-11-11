import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

export const runPendingDeviceCleanup = async () => {
  const now = await getDatabaseTime();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  await services.db.$transaction(async (tx) => {
    const expired = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "UserDevice"
      WHERE "activatedAt" IS NULL
        AND (
          ("revokedAt" IS NULL AND "createdAt" < (${weekAgo}::timestamptz AT TIME ZONE 'UTC'))
          OR "revokedAt" < (${weekAgo}::timestamptz AT TIME ZONE 'UTC')
        )
      FOR UPDATE SKIP LOCKED
    `;
    const deviceIds = expired.map(({ id }) => id);
    if (!deviceIds.length) return;
    await tx.session.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await tx.userDevice.deleteMany({ where: { id: { in: deviceIds } } });
  });
  await services.db.deviceLink.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
  });
  await services.db.deviceChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
};
