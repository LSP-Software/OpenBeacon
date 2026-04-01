/**
 * Test-only utilities behind the `@openbeacon/cache/testing` subpath (`./testing` in package.json).
 * Do not import this module in production; `FakeRedis` and `BucketState` exist to exercise rate limiting
 * in unit tests. Shipping them in app bundles wastes size and can confuse auditors—configure bundlers to
 * omit `./testing` from production graphs where possible.
 */
export type BucketState = {
  expiresAt: number;
  lastMs: number;
  tokens: number;
};

export class FakeRedis {
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

    if (!Number.isFinite(nowMs)) {
      throw new Error("Invalid numeric EVAL argument for nowMs.");
    }
    if (!Number.isFinite(limit)) {
      throw new Error("Invalid numeric EVAL argument for limit.");
    }
    if (!Number.isFinite(windowMs)) {
      throw new Error("Invalid numeric EVAL argument for windowMs.");
    }
    if (!Number.isFinite(cost)) {
      throw new Error("Invalid numeric EVAL argument for cost.");
    }
    if (windowMs <= 0) {
      throw new Error("windowMs must be > 0 for refillRate, retryAfterMs, and resetAfterMs.");
    }
    if (shouldConsumeValue !== "0" && shouldConsumeValue !== "1") {
      throw new Error('shouldConsumeValue must be "0" or "1".');
    }
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
    if (this.closed) {
      throw new Error("Redis client is closed.");
    }

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
