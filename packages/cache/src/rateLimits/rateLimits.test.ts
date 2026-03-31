import { describe, expect, test } from "bun:test";
import { OpenBeaconCache } from "../cache/OpenBeaconCache.ts";

type BucketState = {
  expiresAt: number;
  lastMs: number;
  tokens: number;
};

class FakeRedis {
  private readonly buckets = new Map<string, BucketState>();
  private closed = false;

  public async send(command: string, args: string[]): Promise<string[]> {
    if (this.closed) {
      throw new Error("Redis client is closed.");
    }

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

  public close(): void {
    this.closed = true;
  }
}

class TestOpenBeaconCache extends OpenBeaconCache {
  protected override createRedisClient(): FakeRedis {
    return new FakeRedis();
  }
}

describe("OpenBeaconCache rateLimits", () => {
  test("rejects invalid constructor and method inputs", async () => {
    expect(
      () =>
        new TestOpenBeaconCache({
          redisUrl: "not-a-url",
        }),
    ).toThrow();

    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
    });

    await expect(
      cache.rateLimits.consume({
        namespace: "",
        identifier: {
          type: "userId",
          value: "user-1",
        },
        limit: 60,
        windowMs: 60_000,
      }),
    ).rejects.toThrow();

    await expect(
      cache.rateLimits.peek({
        namespace: "route",
        identifier: {
          type: "ip",
          value: "127.0.0.1",
        },
        limit: 0,
        windowMs: 60_000,
      }),
    ).rejects.toThrow();

    await expect(
      cache.rateLimits.reset({
        namespace: "route",
        identifier: {
          type: "ip",
          value: "",
        },
      }),
    ).rejects.toThrow();
  });

  test("consumes tokens, refills over time, and resets state", async () => {
    let nowMs = 0;
    const cache = new TestOpenBeaconCache({
      redisUrl: "redis://localhost:6379",
      now: () => nowMs,
    });

    const input = {
      namespace: "auth.registerDeviceKey",
      identifier: {
        type: "userId" as const,
        value: "user-1",
      },
      limit: 2,
      windowMs: 1_000,
    };

    await expect(cache.rateLimits.peek(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 2,
      retryAfterMs: 0,
      resetAfterMs: 0,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterMs: 0,
      resetAfterMs: 500,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      retryAfterMs: 0,
      resetAfterMs: 1_000,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterMs: 500,
      resetAfterMs: 1_000,
    });

    nowMs = 500;

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      retryAfterMs: 0,
      resetAfterMs: 1_000,
    });

    nowMs = 1_500;

    await expect(cache.rateLimits.peek(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 2,
      retryAfterMs: 0,
      resetAfterMs: 0,
    });

    await expect(cache.rateLimits.consume(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterMs: 0,
      resetAfterMs: 500,
    });

    await expect(
      cache.rateLimits.reset({
        namespace: input.namespace,
        identifier: input.identifier,
      }),
    ).resolves.toBe(1);

    await expect(cache.rateLimits.peek(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 2,
      retryAfterMs: 0,
      resetAfterMs: 0,
    });
  });
});
