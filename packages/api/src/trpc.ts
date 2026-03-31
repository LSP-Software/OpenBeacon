/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1)
 * 2. You want to create a new middleware or type of procedure (see Part 3)
 *
 * tl;dr - this is where all the tRPC server stuff is created and plugged in.
 * The pieces you will need to use are documented accordingly near the end
 */

import { auth } from "@openbeacon/auth";
import type { OpenBeaconCache } from "@openbeacon/cache";
import type { PrismaClient } from "@openbeacon/database";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import { rateLimitErrorCauseSchema } from "./middlewares/rateLimit.ts";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */

export const createTRPCContext = async (opts: {
  cache: OpenBeaconCache;
  clientIp?: string;
  db: PrismaClient;
  headers: Headers;
}) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });

  return {
    cache: opts.cache,
    db: opts.db,
    session,
    ...(opts.clientIp !== undefined ? { clientIp: opts.clientIp } : {}),
  };
};
export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
export type TRPCMeta = {
  rateLimit?: {
    cost?: number;
    limit: number;
    windowMs: number;
  };
};
/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
export const createTRPCComponents = () => {
  const t = initTRPC
    .context<TRPCContext>()
    .meta<TRPCMeta>()
    .create({
      transformer: superjson,
      errorFormatter: ({ shape, error }) => {
        const rateLimitResult = rateLimitErrorCauseSchema.safeParse(error.cause);

        return {
          ...shape,
          data: {
            ...shape.data,
            rateLimit: rateLimitResult.success ? rateLimitResult.data : null,
            zodError:
              error.cause instanceof ZodError
                ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
                : null,
          },
        };
      },
    });

  return {
    createTRPCRouter: t.router,
    t,
  };
};

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
