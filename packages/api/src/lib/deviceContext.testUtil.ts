import type { PrismaClient } from "@openbeacon/database";
import type { TRPCContext } from "../trpc.ts";

export const withDeviceActive =
  <Context extends { db: Pick<PrismaClient, "userDevice">; deviceId?: string | null }>(
    context: Context,
  ) =>
  async () =>
    ({
      ...context,
      deviceActive: context.deviceId
        ? (await context.db.userDevice.count({
            where: { id: context.deviceId, activatedAt: { not: null }, revokedAt: null },
          })) > 0
        : false,
    }) as unknown as TRPCContext;
