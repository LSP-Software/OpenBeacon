import { checkR2, checkS3 } from "@openbeacon/api/checkStorage.ts";
import { r2Client } from "@openbeacon/api/r2.ts";
import { s3Client } from "@openbeacon/api/s3client.ts";
import { prisma } from "@openbeacon/database";
import { checkServices as checkConnections } from "@openbeacon/shared";
import "./env.ts";

export const services = { db: prisma, s3: s3Client, r2: r2Client };

export const checkServices = async () => {
  const checks = {
    PostgreSQL: () => services.db.$queryRaw`SELECT 1`,
    S3: checkS3,
    R2: checkR2,
  };
  await checkConnections(checks);
};

export const closeServices = async () => {
  services.s3.destroy();
  services.r2.destroy();
  await services.db.$disconnect();
};
