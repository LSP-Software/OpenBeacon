import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { OpenBeaconCache } from "@openbeacon/cache";
import { FakeRedis, testRedisHashSecret, UnavailableRedis } from "@openbeacon/cache/testing";
import { tryCatch } from "@openbeacon/shared";
import { type AnyRouter, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createAuthProcedures } from "../procedures/auth/base.ts";
import { createTRPCComponents } from "../trpc.ts";
import { createRateLimitMiddleware } from "./rateLimitMiddleware.ts";
import { createTimingMiddleware } from "./timingMiddleware.ts";

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

class UnavailableCache extends OpenBeaconCache {
  protected override createRedisClient(): UnavailableRedis {
    return new UnavailableRedis();
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
}): ReturnType<TRouter["createCaller"]> => {
  type CallerContext = Parameters<TRouter["createCaller"]>[0];
  const context: CallerContext = {
    cache,
    db: {},
    deviceId: "device-1",
    deviceActive: true,
    session: userId
      ? {
          user: {
            id: userId,
          },
        }
      : null,
    ...(clientIp !== undefined ? { clientIp } : {}),
  };
  return router.createCaller(context);
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

  test("lets requests through with a log line while Redis is unavailable", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const cache = new UnavailableCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
    });
    const { createTRPCRouter, protectedProcedure, publicProcedure } = createModules();
    const router = createTRPCRouter({
      private: protectedProcedure.query(() => "private"),
      public: publicProcedure
        .meta({ rateLimit: { limit: 1, windowMs: 60_000, scope: "server" } })
        .query(() => "public"),
    });
    await expect(
      createCaller({ cache, clientIp: "10.0.0.1", router, userId: "user-1" }).private(),
    ).resolves.toBe("private");
    await expect(
      createCaller({ cache, clientIp: "10.0.0.1", router, userId: null }).public(),
    ).resolves.toBe("public");
    expect(error.mock.calls).toEqual([
      ["[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so private is allowed"],
      ["[rate-limit] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so public is allowed"],
    ]);
    error.mockRestore();
  });

  test("never keys a limit on the client IP, and leaves anonymous calls without a server-wide limit alone", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    });
    const consume = spyOn(cache.rateLimits, "consume");
    const { createTRPCRouter, protectedProcedure, publicProcedure } = createModules();
    const router = createTRPCRouter({
      public: publicProcedure.query(() => "public"),
      strict: publicProcedure
        .meta({ rateLimit: { limit: 2, windowMs: 60_000 } })
        .query(() => "strict"),
      private: protectedProcedure.query(() => "private"),
    });
    const anonymous = createCaller({ cache, clientIp: "10.0.0.1", router, userId: null });
    const signedIn = createCaller({ cache, clientIp: "10.0.0.1", router, userId: "user-1" });

    for (let index = 0; index < 100; index += 1) {
      await expect(anonymous.public()).resolves.toBe("public");
      await expect(anonymous.strict()).resolves.toBe("strict");
    }
    await signedIn.public();
    await signedIn.private();

    expect(consume.mock.calls.map(([input]) => input.identifier)).toEqual([
      { type: "userId", value: "user-1" },
      { type: "userId", value: "user-1" },
    ]);
  });

  test("limits each account per path, with stricter route overrides", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    });
    const { createTRPCRouter, publicProcedure } = createModules();
    const router = createTRPCRouter({
      shared: publicProcedure.query(() => "shared"),
      strict: publicProcedure
        .meta({ rateLimit: { limit: 2, windowMs: 60_000 } })
        .query(() => "strict"),
      relaxed: publicProcedure.query(() => "relaxed"),
    });
    const first = createCaller({ cache, clientIp: "198.51.100.10", router, userId: "first" });
    const second = createCaller({ cache, clientIp: "198.51.100.10", router, userId: "second" });

    for (let index = 0; index < 60; index += 1) {
      await expect(first.shared()).resolves.toBe("shared");
    }
    await expect(first.shared()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(second.shared()).resolves.toBe("shared");
    await expect(first.strict()).resolves.toBe("strict");
    await expect(first.strict()).resolves.toBe("strict");
    await expect(first.strict()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(first.relaxed()).resolves.toBe("relaxed");
  });

  test("a server-wide limit is shared by every caller, signed in or not", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    });
    const { createTRPCRouter, publicProcedure } = createModules();
    const router = createTRPCRouter({
      submit: publicProcedure
        .meta({ rateLimit: { limit: 3, windowMs: 60_000, scope: "server" } })
        .mutation(() => true),
    });
    const callers = [
      createCaller({ cache, clientIp: "198.51.100.1", router, userId: null }),
      createCaller({ cache, clientIp: "198.51.100.2", router, userId: "user-1" }),
      createCaller({ cache, router, userId: null }),
    ];
    for (const caller of callers) await expect(caller.submit()).resolves.toBe(true);

    const warning = spyOn(console, "warn").mockImplementation(() => {});
    for (const caller of callers) {
      await expect(caller.submit()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    }
    warning.mockRestore();
  });

  test("uses user ids across IP changes and hides rate limit details from clients", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
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

    const rateLimitResult = await tryCatch<"protected", TRPCError>(secondCaller.protectedRoute());
    expect(rateLimitResult.data).toBeNull();
    const thrownError = rateLimitResult.error;
    expect(thrownError).not.toBeNull();
    expect(thrownError?.code).toBe("TOO_MANY_REQUESTS");
    expect(thrownError?.message).toBe("Too many requests. Please try again later.");
    expect(thrownError?.cause).toBeUndefined();

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
          stack: "private-stack-trace",
        },
      },
    });

    const serialized = JSON.stringify(formattedError);
    expect(formattedError.message).toBe("Too many requests. Please try again later.");
    expect(serialized).not.toContain("retryAfterMs");
    expect(serialized).not.toContain("resetAfterMs");
    expect(serialized).not.toContain("remaining");
    expect(serialized).not.toContain("protectedRoute");
    expect(serialized).not.toContain("stack");
  });

  test("returns a generic HTTP rate-limit response without internal details", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    });
    const { createTRPCRouter, protectedProcedure } = createModules();
    const router = createTRPCRouter({
      lookup: protectedProcedure
        .meta({ rateLimit: { limit: 1, windowMs: 60_000 } })
        .query(() => "ok"),
    });
    const request = () =>
      fetchRequestHandler({
        endpoint: "/trpc",
        req: new Request("http://localhost/trpc/lookup"),
        router,
        createContext: () =>
          ({
            cache,
            db: {} as never,
            clientIp: "198.51.100.1",
            deviceId: "device-1",
            deviceActive: true,
            session: { user: { id: "user-1" } },
          }) as never,
      });
    expect((await request()).status).toBe(200);
    const response = await request();
    expect(response.status).toBe(429);
    const body = await response.text();
    expect(body).toContain("Too many requests. Please try again later.");
    for (const secret of [
      "retryAfterMs",
      "resetAfterMs",
      "remaining",
      "windowMs",
      "limit",
      "lookup",
      "stack",
      "198.51.100.1",
      "user-1",
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  test("an account gets forty joins a minute, however many accounts share an IP", async () => {
    const { groupInvitesRouter } = await import("../router/group/groupInvitesRouter.ts");
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    });
    const { createTRPCRouter, protectedProcedure } = createModules();
    const router = createTRPCRouter({
      lookup: protectedProcedure
        .meta(groupInvitesRouter.sharedAcceptanceContext._def.meta)
        .mutation(() => true),
      accept: protectedProcedure
        .meta(groupInvitesRouter.acceptShared._def.meta)
        .mutation(() => true),
    });
    const callers = Array.from({ length: 100 }, (_, index) =>
      createCaller({ cache, clientIp: "10.0.0.1", router, userId: `user-${index}` }),
    );
    for (const caller of callers) {
      await caller.lookup();
      await caller.accept();
    }
    const firstCaller = callers[0]!;
    for (let index = 0; index < 19; index += 1) {
      await firstCaller.lookup();
      await firstCaller.accept();
    }
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    await expect(firstCaller.lookup()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    warning.mockRestore();
    await expect(callers[1]!.lookup()).resolves.toBe(true);
  });

  test("shares a budget across join endpoints", async () => {
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      hashSecret: testRedisHashSecret,
      now: () => 0,
    });
    const { createTRPCRouter, protectedProcedure } = createModules();
    const procedure = protectedProcedure.meta({
      rateLimit: { namespace: "join", limit: 2, windowMs: 60_000 },
    });
    const router = createTRPCRouter({
      lookup: procedure.mutation(() => true),
      accept: procedure.mutation(() => true),
    });
    const first = createCaller({ cache, clientIp: "198.51.100.1", router, userId: "first" });
    const second = createCaller({ cache, clientIp: "198.51.100.1", router, userId: "second" });
    const third = createCaller({ cache, clientIp: "198.51.100.1", router, userId: "third" });
    await expect(first.lookup()).resolves.toBe(true);
    await expect(first.accept()).resolves.toBe(true);
    await expect(first.lookup()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(second.lookup()).resolves.toBe(true);
    await expect(third.accept()).resolves.toBe(true);
  });
});
