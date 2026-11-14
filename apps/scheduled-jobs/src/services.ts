import "./env.ts";
import { checkMapStorage, checkImageStorage } from "@openbeacon/api/checkStorage.ts";
import { mapStorageClient } from "@openbeacon/api/mapStorage.ts";
import { s3Client } from "@openbeacon/api/s3client.ts";
import { createSecurityAlerts } from "@openbeacon/auth/securityAlerts.ts";
import { prisma } from "@openbeacon/database";
import { checkEmail, emailEnabled, sendSecurityAlertEmail } from "@openbeacon/email";
import { checkServices as checkConnections } from "@openbeacon/shared";

const pendingAlerts = new Set<Promise<unknown>>();

export const services = {
  db: prisma,
  s3: s3Client,
  mapStorage: mapStorageClient,
  securityAlerts: emailEnabled
    ? createSecurityAlerts({
        db: prisma,
        sendSecurityAlertEmail,
        runInBackground: (task) => {
          pendingAlerts.add(task);
          void task.finally(() => pendingAlerts.delete(task));
        },
      })
    : null,
};

export const waitForSecurityAlerts = async () => {
  await Promise.all(pendingAlerts);
};

export const checkServices = async () => {
  const checks = {
    PostgreSQL: () => services.db.$queryRaw`SELECT 1`,
    "Image storage": checkImageStorage,
    "Map storage": checkMapStorage,
    ...(emailEnabled ? { Email: checkEmail } : {}),
  };
  await checkConnections(checks);
};

export const closeServices = async () => {
  await waitForSecurityAlerts();
  services.s3.destroy();
  services.mapStorage.destroy();
  await services.db.$disconnect();
};
