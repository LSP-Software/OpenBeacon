import { auth } from "@openbeacon/auth";
import { TRPCError } from "@trpc/server";
import { deviceUnverifiedError } from "../../lib/deviceUnverified.ts";
import { t } from "../../trpcRuntime.ts";
import { createAuthProcedures } from "./base.ts";
import { ReasonError } from "../../lib/reasonError.ts";

export const { protectedProcedure, publicProcedure, setupProcedure } = createAuthProcedures({ t });

export const sessionFreshForMs = async (sessionCreatedAt: Date): Promise<number | null> => {
  const { sessionConfig } = await auth.$context;
  if (sessionConfig.freshAge === 0) return null;
  const sessionAge = Date.now() - new Date(sessionCreatedAt).getTime();
  return Math.max(0, sessionConfig.freshAge * 1000 - sessionAge);
};

export const requireFreshSession = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  if ((await sessionFreshForMs(ctx.session.session.createdAt)) === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sign in again to continue.",
      cause: new ReasonError("FRESH_SIGN_IN_REQUIRED"),
    });
  }
  return next();
});

export const freshSessionProcedure = protectedProcedure.use(requireFreshSession);

export const requireThisDevice = t.middleware(async ({ ctx, next }) => {
  if (!ctx.deviceId) {
    if (ctx.unverifiedDeviceId) throw deviceUnverifiedError();
    throw new TRPCError({ code: "BAD_REQUEST", message: "This phone isn't registered yet." });
  }
  return next({ ctx: { deviceId: ctx.deviceId } });
});

export const setupDeviceProcedure = setupProcedure.use(requireThisDevice);
