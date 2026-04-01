import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis } from "@openbeacon/cache/testing";
import { type AnyRouter, TRPCError } from "@trpc/server";
import { createAuthProcedures } from "../procedures/auth/base.ts";
import { createTRPCComponents } from "../trpc.ts";
import { createRateLimitMiddleware } from "./rateLimitMiddleware.ts";
import { createTimingMiddleware } from "./timingMiddleware.ts";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;
let originalNodeEnv: string | undefined;

const createModules = () => {
  const { t, createTRPCRouter } = createTRPCComponents();
  const rateLimitMiddleware = createRateLimitMiddleware({ t });
  const timingMiddleware = createTimingMiddleware({ t });
  const { publicProcedure, protectedProcedure } = createAuthProcedures({
    t,
    rateLimitMiddleware,
    timingMiddleware,
  });

  return {
    createTRPCRouter,
    protectedProcedure,
    publicProcedure,
    t,
  };
};

const createCaller = <TRouter extends AnyRouter>({
  cache,
  clientIp,
  router,
  userId,
}: {
  cache: OpenBeaconCache;
  clientIp?: string;
  router: TRouter;
  userId: string | null;
}): ReturnType<TRouter["createCaller"]> =>
  router.createCaller({
    cache,
    db: {},
    session: userId
      ? {
          user: {
            id: userId,
          },
        }
      : null,
    ...(clientIp !== undefined ? { clientIp } : {}),
  } as Parameters<TRouter["createCaller"]>[0]);

describe("rateLimitMiddleware", () => {
  beforeEach(() => {
    originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
    originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "test-secret-000000000000000000000000";
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    if (originalBetterAuthUrl === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
    }

    if (originalBetterAuthSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test("applies the default limit independently per path and falls back to client IP for public routes", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      now: () => 0,
    });
    const { createTRPCRouter, publicProcedure } = createModules();
    const router = createTRPCRouter({
      publicA: publicProcedure.query(() => "public-a"),
      publicB: publicProcedure.query(() => "public-b"),
    });
    const ipOneCaller = createCaller({
      cache,
      clientIp: "10.0.0.1",
      router,
      userId: null,
    });
    const ipTwoCaller = createCaller({
      cache,
      clientIp: "10.0.0.2",
      router,
      userId: null,
    });

    for (let index = 0; index < 60; index += 1) {
      await expect(ipOneCaller.publicA()).resolves.toBe("public-a");
    }

    await expect(ipOneCaller.publicA()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    await expect(ipOneCaller.publicB()).resolves.toBe("public-b");
    await expect(ipTwoCaller.publicA()).resolves.toBe("public-a");
  });

  test("uses stricter route overrides and keeps user-id and IP buckets separate on the same public path", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      now: () => 0,
    });
    const { createTRPCRouter, publicProcedure } = createModules();
    const router = createTRPCRouter({
      shared: publicProcedure.query(() => "shared"),
      strict: publicProcedure
        .meta({
          rateLimit: {
            limit: 2,
            windowMs: 60_000,
          },
        })
        .query(() => "strict"),
      relaxed: publicProcedure.query(() => "relaxed"),
    });
    const authenticatedCaller = createCaller({
      cache,
      clientIp: "198.51.100.10",
      router,
      userId: "shared-key",
    });
    const ipCaller = createCaller({
      cache,
      clientIp: "shared-key",
      router,
      userId: null,
    });
    const strictCaller = createCaller({
      cache,
      clientIp: "203.0.113.20",
      router,
      userId: null,
    });

    for (let index = 0; index < 60; index += 1) {
      await expect(authenticatedCaller.shared()).resolves.toBe("shared");
    }

    await expect(authenticatedCaller.shared()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    await expect(ipCaller.shared()).resolves.toBe("shared");
    await expect(strictCaller.strict()).resolves.toBe("strict");
    await expect(strictCaller.strict()).resolves.toBe("strict");
    await expect(strictCaller.strict()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    await expect(strictCaller.relaxed()).resolves.toBe("relaxed");
  });

  test("uses user ids for protected routes even when the client IP changes and formats rate limit data", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      now: () => 0,
    });
    const { createTRPCRouter, protectedProcedure, t } = createModules();
    const router = createTRPCRouter({
      protectedRoute: protectedProcedure.query(() => "protected"),
    });
    const firstCaller = createCaller({
      cache,
      clientIp: "203.0.113.30",
      router,
      userId: "user-1",
    });
    const secondCaller = createCaller({
      cache,
      clientIp: "203.0.113.31",
      router,
      userId: "user-1",
    });

    for (let index = 0; index < 60; index += 1) {
      await expect(firstCaller.protectedRoute()).resolves.toBe("protected");
    }

    let thrownError: TRPCError | null = null;

    try {
      await secondCaller.protectedRoute();
    } catch (error) {
      thrownError = error as TRPCError;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.code).toBe("TOO_MANY_REQUESTS");
    expect(thrownError?.cause).toMatchObject({
      limit: 60,
      remaining: 0,
      retryAfterMs: 1_000,
      resetAfterMs: 60_000,
    });

    const formattedError = t._config.errorFormatter({
      error: new TRPCError({
        code: "TOO_MANY_REQUESTS",
        cause: {
          limit: 60,
          remaining: 0,
          retryAfterMs: 1_000,
          resetAfterMs: 60_000,
        },
      }),
      type: "query",
      path: "protectedRoute",
      input: undefined,
      ctx: undefined,
      shape: {
        message: "Rate limit exceeded.",
        code: -32029,
        data: {
          code: "TOO_MANY_REQUESTS",
          httpStatus: 429,
          path: "protectedRoute",
        },
      },
    });

    expect(formattedError.data.rateLimit).toEqual({
      limit: 60,
      remaining: 0,
      retryAfterMs: 1_000,
      resetAfterMs: 60_000,
    });
  });

  test("rejects anonymous requests without a client IP", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      now: () => 0,
    });
    const { createTRPCRouter, publicProcedure } = createModules();
    const router = createTRPCRouter({
      publicRoute: publicProcedure.query(() => "public"),
    });
    const caller = createCaller({
      cache,
      router,
      userId: null,
    });

    await expect(caller.publicRoute()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Client IP is required for anonymous rate-limited requests.",
    });
  });
});
