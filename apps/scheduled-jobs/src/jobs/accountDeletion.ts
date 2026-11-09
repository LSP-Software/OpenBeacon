import { deleteAccountRecords } from "@openbeacon/api/account-deletion.ts";
import { env } from "@openbeacon/api/env.ts";
import { deleteImageKey, deleteUserImages } from "@openbeacon/api/storage.ts";
import { tryCatch } from "@openbeacon/shared";
import { getDatabaseTime } from "../databaseTime.ts";
import { services, waitForSecurityAlerts } from "../services.ts";

export const runAccountDeletion = async () => {
  const now = await getDatabaseTime();
  const due = await services.db.user.findMany({
    where: {
      pendingDeletion: true,
      deletionDate: { lte: now },
      OR: [{ deletionRetryAt: null }, { deletionRetryAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: { deletionDate: "asc" },
    take: 100,
  });
  for (const user of due) {
    const result = await tryCatch(
      deleteAccountRecords({
        db: services.db,
        userId: user.id,
        imageUrlPrefix: `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}`,
        mode: "scheduled",
        securityAlerts: services.securityAlerts,
      }),
    );
    if (result.error) {
      await services.db.user.updateMany({
        where: { id: user.id, pendingDeletion: true },
        data: { deletionRetryAt: new Date((await getDatabaseTime()).getTime() + 300_000) },
      });
      console.error("Scheduled account deletion failed");
    }
  }
  const cleanup = await services.db.accountDeletionCleanup.findMany({
    where: {
      createdAt: { lte: new Date(now.getTime() - 10 * 60_000) },
      OR: [{ retryAt: null }, { retryAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const item of cleanup) {
    const result = await tryCatch(
      (async () => {
        await deleteUserImages(env.S3_BUCKET_NAME, item.userId);
        for (const key of item.imageKeys) await deleteImageKey(env.S3_BUCKET_NAME, key);
      })(),
    );
    if (result.error) {
      await services.db.accountDeletionCleanup.updateMany({
        where: { userId: item.userId },
        data: { retryAt: new Date((await getDatabaseTime()).getTime() + 300_000) },
      });
      console.error("Account image cleanup failed");
      continue;
    }
    await services.db.accountDeletionCleanup.deleteMany({ where: { userId: item.userId } });
  }
  await waitForSecurityAlerts();
};
