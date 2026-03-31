import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { TRPCError } from "@trpc/server";

type BucketState = {
  expiresAt: number;
  lastMs: number;
  tokens: number;
};

class FakeRedis {
  private readonly buckets = new Map<string, BucketState>();

  public async send(command: string, args: string[]): Promise<string[]> {
    if (command !== "EVAL") {
      throw new Error(`Unsupported command: ${command}`);
    }

    const [, , key, nowMsValue, limitValue, windowMsValue, costValue, shouldConsumeValue] = args;

    if (!key || !nowMsValue || !limitValue || !windowMsValue || !costValue || !shouldConsumeValue) {
      throw new Error("Missing EVAL arguments.");
    }

    const nowMs = Number(nowMsValue);
    const limit = Number(limitValue);
    const windowMs = Number(windowMsValue);
    const cost = Number(costValue);
    const shouldConsume = shouldConsumeValue === "1";
    const refillRate = limit / windowMs;
    const existingBucket = this.buckets.get(key);
    const activeBucket =
      existingBucket && existingBucket.expiresAt > nowMs
        ? existingBucket
        : { tokens: limit, lastMs: nowMs, expiresAt: nowMs + windowMs };
    const refilledTokens =
      nowMs > activeBucket.lastMs
        ? Math.min(limit, activeBucket.tokens + (nowMs - activeBucket.lastMs) * refillRate)
        : activeBucket.tokens;
    const remainingTokens =
      shouldConsume && refilledTokens >= cost ? refilledTokens - cost : refilledTokens;
    const allowed = refilledTokens >= cost;
    const retryAfterMs = allowed ? 0 : Math.ceil((cost - remainingTokens) / refillRate);
    const resetAfterMs = Math.ceil(Math.max(0, limit - remainingTokens) / refillRate);

    this.buckets.set(key, {
      tokens: remainingTokens,
      lastMs: nowMs,
      expiresAt: nowMs + Math.max(windowMs, resetAfterMs),
    });

    return [
      allowed ? "1" : "0",
      String(limit),
      String(Math.max(0, Math.floor(remainingTokens))),
      String(Math.max(0, retryAfterMs)),
      String(Math.max(0, resetAfterMs)),
    ];
  }

  public async del(...keys: string[]): Promise<number> {
    let deletedKeys = 0;

    keys.forEach((key) => {
      if (this.buckets.delete(key)) {
        deletedKeys += 1;
      }
    });

    return deletedKeys;
  }

  public close(): void {}
}

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;
let originalNodeEnv: string | undefined;

const createModules = async () => {
  const cacheBuster = `test=${Math.random().toString(36).slice(2)}`;

  return Promise.all([
    import(`../trpc.ts?${cacheBuster}`),
    import(`../procedures/auth/base.ts?${cacheBuster}`),
  ]);
};

const createCaller = <TRouter extends { createCaller: (ctx: unknown) => unknown }>({
  cache,
  clientIp,
  router,
  userId,
}: {
  cache: OpenBeaconCache;
  clientIp: string | null;
  router: TRouter;
  userId: string | null;
}) => {
  return router.createCaller({
    cache,
    clientIp,
    db: {},
    session: userId
      ? {
          user: {
            id: userId,
          },
        }
      : null,
  }) as ReturnType<TRouter["createCaller"]>;
};

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
    const [{ createTRPCRouter }, { publicProcedure }] = await createModules();
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
    const [{ createTRPCRouter }, { publicProcedure }] = await createModules();
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
    const [{ createTRPCRouter, t }, { protectedProcedure }] = await createModules();
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

    const formattedError = t._config.errorFormatter({
      error: new TRPCError({
        code: "TOO_MANY_REQUESTS",
        cause: {
          limit: 60,
          remaining: 0,
          retryAfterMs: 1_000,
          resetAfterMs: 1_000,
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
      resetAfterMs: 1_000,
    });
  });
});
