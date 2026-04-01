import { TRPCError } from "@trpc/server";
import type { createTRPCComponents } from "../trpc.ts";
import {
  defaultRateLimitMeta,
  rateLimitErrorCauseSchema,
  rateLimitMetaSchema,
} from "./rateLimit.ts";

export const createRateLimitMiddleware = ({
  t,
}: {
  t: ReturnType<typeof createTRPCComponents>["t"];
}) =>
  t.middleware(async ({ ctx, meta, next, path }) => {
    const rateLimit = rateLimitMetaSchema.parse(meta?.rateLimit ?? defaultRateLimitMeta);
    const identifier = ctx.session?.user
      ? {
          type: "userId" as const,
          value: ctx.session.user.id,
        }
      : ctx.clientIp
        ? {
            type: "ip" as const,
            value: ctx.clientIp,
          }
        : null;

    if (identifier === null) {
      console.warn(`[rateLimitMiddleware] missing clientIp path=${path}`);
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Client IP is required for anonymous rate-limited requests.",
      });
    }

    const result = await ctx.cache.rateLimits.consume({
      namespace: path,
      identifier,
      limit: rateLimit.limit,
      windowMs: rateLimit.windowMs,
      cost: rateLimit.cost,
    });

    if (!result.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded.",
        cause: rateLimitErrorCauseSchema.parse({
          limit: result.limit,
          remaining: result.remaining,
          retryAfterMs: result.retryAfterMs,
          resetAfterMs: result.resetAfterMs,
        }),
      });
    }

    return next();
  });
