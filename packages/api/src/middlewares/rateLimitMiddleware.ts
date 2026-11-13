import { logRateLimit } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type { createTRPCComponents } from "../trpc.ts";
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

    const result = await ctx.cache.rateLimits.consume(
      {
        namespace: rateLimit.namespace ?? path,
        identifier,
        limit: rateLimit.limit,
        windowMs: rateLimit.windowMs,
        cost: rateLimit.cost,
      },
      { whenUnavailable: "allow" },
    );

    if (!result.allowed) {
      logRateLimit({ path, scope: identifier.type });
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please try again later.",
      });
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
      const ipResult = await ctx.cache.rateLimits.consume(
        {
          namespace: rateLimit.namespace ?? path,
          identifier: { type: "ip", value: ctx.clientIp },
          limit: rateLimit.ipLimit,
          windowMs: rateLimit.windowMs,
          cost: rateLimit.cost,
        },
        { whenUnavailable: "allow" },
      );
      if (!ipResult.allowed) {
        logRateLimit({ path, scope: "ip" });
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please try again later.",
        });
      }
    }

    return next();
  });
