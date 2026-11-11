import { authCapabilities } from "@openbeacon/auth";
import { registerDeviceKeySchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import z from "zod";
import {
  listHistoryRecipients,
  listUserRecipientPublicKeys,
  upsertUserDevice,
} from "../lib/groupEpochs.ts";
import { protectedProcedure, publicProcedure } from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";

export const authRouter = createTRPCRouter({
  providers: publicProcedure.query(() => authCapabilities),
  deviceKeyContext: protectedProcedure
    .meta({ rateLimit: { limit: 240, windowMs: 60_000 } })
    .query(async ({ ctx }) => ({
      historyRecipients: await listHistoryRecipients({
        db: ctx.db,
        where: { userId: ctx.session.user.id },
      }),
      recipients: await listUserRecipientPublicKeys({
        db: ctx.db,
        userId: ctx.session.user.id,
      }),
      userId: ctx.session.user.id,
    })),
  registerDeviceKey: protectedProcedure
    .meta({
      rateLimit: {
        limit: 120,
        windowMs: 60_000,
      },
    })
    .input(registerDeviceKeySchema.extend({ expectedUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (input.expectedUserId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "The active account has changed." });
      }
      const device = await upsertUserDevice({
        db: ctx.db,
        input,
        securityAlerts: ctx.securityAlerts,
        sessionId: ctx.session.session.id,
        userId: ctx.session.user.id,
      });
      const session = await ctx.db.session.findUnique({
        select: { deviceId: true },
        where: { id: ctx.session.session.id },
      });
      return { ...device, sessionLinked: session?.deviceId === device.id };
    }),
  listMyDeviceKeys: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.userDevice.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        createdAt: true,
        id: true,
        lastSeenAt: true,
        publicKey: true,
        publicKeyAlgorithm: true,
        revokedAt: true,
      },
      where: {
        userId: ctx.session.user.id,
      },
    }),
  ),
});
