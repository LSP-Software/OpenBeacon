import { TRPCError } from "@trpc/server";
import { createRateLimitMiddleware } from "../../middlewares/rateLimitMiddleware.ts";
import { createTimingMiddleware } from "../../middlewares/timingMiddleware.ts";
import type { createTRPCComponents } from "../../trpc.ts";

export const createAuthProcedures = ({
  t,
  rateLimitMiddleware = createRateLimitMiddleware({ t }),
  timingMiddleware = createTimingMiddleware({ t }),
}: {
  t: ReturnType<typeof createTRPCComponents>["t"];
  rateLimitMiddleware?: ReturnType<typeof createRateLimitMiddleware>;
  timingMiddleware?: ReturnType<typeof createTimingMiddleware>;
}) => {
  const publicProcedure = t.procedure.use(rateLimitMiddleware).use(timingMiddleware);

  const protectedProcedure = t.procedure
    .use(({ ctx, next }) => {
      if (!ctx.session?.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      return next({
        ctx: {
          session: { ...ctx.session, user: ctx.session.user },
        },
      });
    })
    .use(rateLimitMiddleware)
    .use(timingMiddleware);

  return {
    protectedProcedure,
    publicProcedure,
  };
};
