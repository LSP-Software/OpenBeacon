import { TRPCError } from "@trpc/server";
import type { createTRPCComponents, TRPCContext } from "../trpc.ts";
import { defaultRateLimitMeta, RateLimitContextError, rateLimitMetaSchema } from "./rateLimit.ts";

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
        message: "Unable to process request.",
        cause: new RateLimitContextError(),
      });
    }

    const result = await ctx.cache.rateLimits.consume({
      namespace: rateLimit.namespace ?? path,
      identifier,
      limit: rateLimit.limit,
      windowMs: rateLimit.windowMs,
      cost: rateLimit.cost,
    });

    if (!result.allowed) {
      throwRateLimitError({ path, scope: identifier.type, result });
    }

    if (rateLimit.ipLimit !== undefined && identifier.type === "userId") {
      if (!ctx.clientIp) {
        console.warn(`[rateLimitMiddleware] missing clientIp path=${path}`);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unable to process request.",
          cause: new RateLimitContextError(),
        });
      }
      const ipResult = await ctx.cache.rateLimits.consume({
        namespace: rateLimit.namespace ?? path,
        identifier: { type: "ip", value: ctx.clientIp },
        limit: rateLimit.ipLimit,
        windowMs: rateLimit.windowMs,
        cost: rateLimit.cost,
      });
      if (!ipResult.allowed) {
        throwRateLimitError({ path, scope: "ip", result: ipResult });
      }
    }

    return next();
  });

const throwRateLimitError = ({
  path,
  result,
  scope,
}: {
  path: string;
  result: Awaited<ReturnType<TRPCContext["cache"]["rateLimits"]["consume"]>>;
  scope: "userId" | "ip";
}): never => {
  console.warn("[rateLimitMiddleware] request limited", {
    path,
    scope,
    limit: result.limit,
    remaining: result.remaining,
    retryAfterMs: result.retryAfterMs,
    resetAfterMs: result.resetAfterMs,
  });
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Too many requests. Please try again later.",
  });
};
