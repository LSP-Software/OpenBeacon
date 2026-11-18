import type { PrismaClient } from "@openbeacon/database";
import { emailCodeSchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import { ReasonError } from "../lib/reasonError.ts";
import { freshSessionProcedure, protectedProcedure } from "../procedures/auth/runtime.ts";
import { createTRPCRouter } from "../trpcRuntime.ts";

const hasPassword = async (db: PrismaClient, userId: string) =>
  (await db.account.count({
    where: { userId, providerId: "credential", password: { not: null } },
  })) > 0;

const turnOnProcedure = freshSessionProcedure
  .meta({ rateLimit: { limit: 10, windowMs: 60_000 } })
  .use(async ({ ctx, next }) => {
    if (!ctx.emailCodes) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Email isn't set up on this server." });
    }
    if (!(await hasPassword(ctx.db, ctx.session.user.id))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Sign-in codes are only for accounts that sign in with a password.",
      });
    }
    return next({ ctx: { emailCodes: ctx.emailCodes } });
  });

export const signInCodesRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [user, password] = await Promise.all([
      ctx.db.user.findUniqueOrThrow({ where: { id: userId }, select: { signInCodes: true } }),
      hasPassword(ctx.db, userId),
    ]);
    return {
      on: user.signInCodes,
      canTurnOn: password && ctx.emailCodes !== null,
    };
  }),
  requestTurnOnCode: turnOnProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      select: { email: true, id: true },
      where: { id: ctx.session.user.id },
    });
    const allowed = await ctx.emailCodes.allowRequest({
      purpose: "turn-on-sign-in-codes",
      email: user.email,
    });
    if (allowed !== "allowed") {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          allowed === "unavailable"
            ? "Codes can't be sent right now. Try again in a minute."
            : "Too many codes have been requested. Try again in a few minutes.",
      });
    }
    await ctx.emailCodes.send({
      purpose: "turn-on-sign-in-codes",
      subject: user.id,
      to: user.email,
      userId: user.id,
    });
    return { email: user.email };
  }),
  turnOn: turnOnProcedure.input(emailCodeSchema).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const result = await ctx.emailCodes.check({
      code: input.code,
      purpose: "turn-on-sign-in-codes",
      subject: userId,
    });
    if (!result.valid) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The code is wrong or has expired.",
        cause: new ReasonError("INVALID_CODE"),
      });
    }
    const changed = await ctx.db.user.updateMany({
      where: { id: userId, signInCodes: false },
      data: { signInCodes: true },
    });
    if (changed.count === 1) {
      ctx.securityAlerts?.send(userId, { type: "sign-in-codes-turned-on" }, ctx.deviceId);
    }
    return { on: true };
  }),
  turnOff: freshSessionProcedure
    .meta({ rateLimit: { limit: 10, windowMs: 60_000 } })
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      const changed = await ctx.db.user.updateMany({
        where: { id: userId, signInCodes: true },
        data: { signInCodes: false },
      });
      if (changed.count === 1) {
        ctx.securityAlerts?.send(userId, { type: "sign-in-codes-turned-off" }, ctx.deviceId);
      }
      return { on: false };
    }),
});
