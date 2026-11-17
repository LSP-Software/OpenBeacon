import { authCapabilities } from "@openbeacon/auth";
import { setNotificationSettingSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import {
  changeNotificationSettings,
  readNotificationSettings,
} from "../lib/notificationSettings.ts";
import { protectedProcedure } from "../procedures/auth/runtime.ts";

export const notificationSettingsRouter = {
  get: protectedProcedure.query(async ({ ctx }) => ({
    canSendEmail: authCapabilities.email,
    settings: await readNotificationSettings(ctx.db, ctx.session.user.id),
  })),
  set: protectedProcedure.input(setNotificationSettingSchema).mutation(async ({ ctx, input }) => ({
    canSendEmail: authCapabilities.email,
    settings: await changeNotificationSettings({
      db: ctx.db,
      securityAlerts: ctx.securityAlerts,
      userId: ctx.session.user.id,
      deviceId: ctx.deviceId,
      changes: [input],
    }),
  })),
} satisfies TRPCRouterRecord;
