import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

export const runPendingDeviceCleanup = async () => {
  const now = await getDatabaseTime();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const expired = {
    activatedAt: null,
    OR: [{ revokedAt: null, createdAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }],
  };
  await services.db.$transaction([
    services.db.session.deleteMany({ where: { device: { is: expired } } }),
    services.db.userDevice.deleteMany({ where: expired }),
    services.db.deviceLink.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
    }),
    services.db.deviceChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
};
