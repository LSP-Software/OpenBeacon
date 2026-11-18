import { TRPCError } from "@trpc/server";
import { devicePendingError } from "../../lib/deviceActivation.ts";
import { deviceUnverifiedError } from "../../lib/deviceUnverified.ts";
import { createRateLimitMiddleware } from "../../middlewares/rateLimitMiddleware.ts";
import type { createTRPCComponents } from "../../trpc.ts";

export const createAuthProcedures = ({
  t,
}: {
  t: ReturnType<typeof createTRPCComponents>["t"];
}) => {
  const rateLimitMiddleware = createRateLimitMiddleware({ t });
  const publicProcedure = t.procedure.use(rateLimitMiddleware);

  const signedInProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    return next({
      ctx: {
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

  const setupProcedure = signedInProcedure.use(rateLimitMiddleware);

  const protectedProcedure = signedInProcedure
    .use(({ ctx, next }) => {
      if (!ctx.deviceId && ctx.unverifiedDeviceId) throw deviceUnverifiedError();
      if (!ctx.deviceId || !ctx.deviceActive) throw devicePendingError();
      return next({ ctx: { deviceId: ctx.deviceId } });
    })
    .use(rateLimitMiddleware);

  return {
    protectedProcedure,
    publicProcedure,
    setupProcedure,
  };
};
