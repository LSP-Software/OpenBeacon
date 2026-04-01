import { TRPCError } from "@trpc/server";
import { createRateLimitMiddleware } from "../../middlewares/rateLimitMiddleware.ts";
import { createTimingMiddleware } from "../../middlewares/timingMiddleware.ts";
import type { createTRPCComponents } from "../../trpc.ts";

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
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

  /**
   * Protected (authenticated) procedure
   *
   * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
   * the session is valid and guarantees `ctx.session.user` is not null.
   *
   * @see https://trpc.io/docs/procedures
   */
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
