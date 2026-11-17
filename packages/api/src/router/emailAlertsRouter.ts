import { emailAlertSettingsSchema, timezoneSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import {
  changeNotificationSettings,
  readNotificationSettings,
} from "../lib/notificationSettings.ts";
import { protectedProcedure } from "../procedures/auth/runtime.ts";

const toEmailAlertSettings = (settings: Awaited<ReturnType<typeof readNotificationSettings>>) => ({
  alertNewSignIn: settings.find(({ type }) => type === "NEW_SIGN_IN")?.email ?? true,
  alertDeletionScheduled: settings.find(({ type }) => type === "DELETION_SCHEDULED")?.email ?? true,
});

export const emailAlertsRouter = {
  settings: protectedProcedure.query(async ({ ctx }) =>
    toEmailAlertSettings(await readNotificationSettings(ctx.db, ctx.session.user.id)),
  ),
  updateSettings: protectedProcedure
    .input(emailAlertSettingsSchema)
    .mutation(async ({ ctx, input }) =>
      toEmailAlertSettings(
        await changeNotificationSettings({
          db: ctx.db,
          securityAlerts: ctx.securityAlerts,
          userId: ctx.session.user.id,
          deviceId: ctx.deviceId,
          changes: [
            { type: "NEW_SIGN_IN", channel: "email", enabled: input.alertNewSignIn },
            {
              type: "DELETION_SCHEDULED",
              channel: "email",
              enabled: input.alertDeletionScheduled,
            },
          ],
        }),
      ),
    ),
  setTimezone: protectedProcedure
    .input(z.object({ timezone: timezoneSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({
        data: { timezone: input.timezone },
        where: { id: ctx.session.user.id },
      });
    }),
} satisfies TRPCRouterRecord;
