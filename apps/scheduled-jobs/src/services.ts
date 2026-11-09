import { checkR2, checkS3 } from "@openbeacon/api/checkStorage.ts";
import { r2Client } from "@openbeacon/api/r2.ts";
import { s3Client } from "@openbeacon/api/s3client.ts";
import { createSecurityAlerts } from "@openbeacon/auth/securityAlerts.ts";
import { prisma } from "@openbeacon/database";
import { checkEmail, emailEnabled, sendSecurityAlertEmail } from "@openbeacon/email";
import { checkServices as checkConnections } from "@openbeacon/shared";
import "./env.ts";

const pendingAlerts = new Set<Promise<unknown>>();

export const services = {
  db: prisma,
  s3: s3Client,
  r2: r2Client,
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
    S3: checkS3,
    R2: checkR2,
    ...(emailEnabled ? { Email: checkEmail } : {}),
  };
  await checkConnections(checks);
};

export const closeServices = async () => {
  await waitForSecurityAlerts();
  services.s3.destroy();
  services.r2.destroy();
  await services.db.$disconnect();
};
