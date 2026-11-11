import { auth } from "@openbeacon/auth";
import { TRPCError } from "@trpc/server";
import { devicePendingError } from "../../lib/deviceActivation.ts";
import { deviceUnverifiedError } from "../../lib/deviceUnverified.ts";
import type { TRPCContext } from "../../trpc.ts";
import { t } from "../../trpcRuntime.ts";
import { createAuthProcedures } from "./base.ts";

const procedures = createAuthProcedures({ t });

export const protectedProcedure = procedures.protectedProcedure;
export const publicProcedure = procedures.publicProcedure;

export const sessionFreshForMs = async (sessionCreatedAt: Date): Promise<number | null> => {
  const { sessionConfig } = await auth.$context;
  if (sessionConfig.freshAge === 0) return null;
  const sessionAge = Date.now() - new Date(sessionCreatedAt).getTime();
  return Math.max(0, sessionConfig.freshAge * 1000 - sessionAge);
};

export const freshSessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if ((await sessionFreshForMs(ctx.session.session.createdAt)) === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again to continue." });
  }
  return next();
});

export const requireThisDevice = t.middleware(async ({ ctx, next }) => {
  if (!ctx.deviceId) {
    if (ctx.unverifiedDeviceId) throw deviceUnverifiedError();
    throw new TRPCError({ code: "BAD_REQUEST", message: "This phone isn't registered yet." });
  }
  return next({ ctx: { deviceId: ctx.deviceId } });
});

export const thisDeviceProcedure = protectedProcedure.use(requireThisDevice);

export const findActiveDeviceId = async (
  ctx: Pick<TRPCContext, "db" | "deviceId" | "session" | "unverifiedDeviceId">,
) => {
  if (!ctx.deviceId && ctx.unverifiedDeviceId) throw deviceUnverifiedError();
  const userId = ctx.session?.user.id;
  const device =
    ctx.deviceId && userId
      ? await ctx.db.userDevice.findFirst({
          select: { id: true },
          where: { id: ctx.deviceId, userId, activatedAt: { not: null }, revokedAt: null },
        })
      : null;
  if (!device) throw devicePendingError();
  return device.id;
};

export const requireActiveDevice = t.middleware(async ({ ctx, next }) =>
  next({ ctx: { deviceId: await findActiveDeviceId(ctx) } }),
);

export const activeDeviceProcedure = protectedProcedure.use(requireActiveDevice);
