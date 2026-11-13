import { logRateLimit } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type { createTRPCComponents } from "../trpc.ts";
import { defaultRateLimitMeta, rateLimitMetaSchema } from "./rateLimit.ts";

export const createRateLimitMiddleware = ({
  t,
}: {
  t: ReturnType<typeof createTRPCComponents>["t"];
}) =>
  t.middleware(async ({ ctx, meta, next, path }) => {
    const rateLimit = rateLimitMetaSchema.parse(meta?.rateLimit ?? defaultRateLimitMeta);
    const identifier =
      rateLimit.scope === "server"
        ? { type: "server" as const }
        : ctx.session?.user
          ? { type: "userId" as const, value: ctx.session.user.id }
          : null;
    if (identifier === null) return next();

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

    return next();
  });
