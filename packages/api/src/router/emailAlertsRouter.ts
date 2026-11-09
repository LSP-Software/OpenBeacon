import { Prisma } from "@openbeacon/database";
import { type OptionalSecurityAlert, optionalSecurityAlerts } from "@openbeacon/email";
import { emailAlertSettingsSchema, timezoneSchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../procedures/auth/runtime.ts";

const settingsSelect = { alertDeletionScheduled: true, alertNewDevice: true };

export const emailAlertsRouter = {
  settings: protectedProcedure.query(({ ctx }) =>
    ctx.db.user.findUniqueOrThrow({ select: settingsSelect, where: { id: ctx.session.user.id } }),
  ),
  updateSettings: protectedProcedure
    .input(emailAlertSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { before, after } = await ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`,
        );
        return {
          before: await tx.user.findUniqueOrThrow({
            select: settingsSelect,
            where: { id: userId },
          }),
          after: await tx.user.update({
            data: input,
            select: settingsSelect,
            where: { id: userId },
          }),
        };
      });
      const turnedOff = (Object.keys(optionalSecurityAlerts) as OptionalSecurityAlert[]).filter(
        (type) => before[optionalSecurityAlerts[type]] && !after[optionalSecurityAlerts[type]],
      );
      if (turnedOff.length)
        ctx.securityAlerts?.send(userId, { type: "alerts-turned-off", alerts: turnedOff });
      return after;
    }),
  setTimezone: protectedProcedure
    .input(z.object({ timezone: timezoneSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({
        data: { timezone: input.timezone },
        where: { id: ctx.session.user.id },
      });
    }),
} satisfies TRPCRouterRecord;
