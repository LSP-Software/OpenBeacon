export type BucketState = {
  expiresAt: number;
  lastMs: number;
  tokens: number;
};

type StringValueState = {
  expiresAt: number;
  value: string;
};

export class FakeRedis {
  private readonly buckets = new Map<string, BucketState>();
  private readonly strings = new Map<string, StringValueState>();
  private closed = false;

  public async send(command: string, args: string[]): Promise<string[] | string | null> {
    if (this.closed) {
      throw new Error("Redis client is closed.");
    }

    if (command === "GET") {
      const [key] = args;

      if (!key) {
        throw new Error("Missing GET key.");
      }

      const value = this.strings.get(key);

      if (!value) {
        return null;
      }

      return value.expiresAt > Date.now() ? value.value : null;
    }

    if (command === "SET") {
      const [key, value, expirationType, ttlMsValue] = args;

      if (!key || !value || expirationType !== "PX" || !ttlMsValue) {
        throw new Error("Invalid SET arguments.");
      }

      this.strings.set(key, {
        expiresAt: Date.now() + Number(ttlMsValue),
        value,
      });

      return "OK";
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
    if (this.closed) {
      throw new Error("Redis client is closed.");
    }

    let deletedKeys = 0;

    keys.forEach((key) => {
      if (this.buckets.delete(key)) {
        deletedKeys += 1;
      }

      if (this.strings.delete(key)) {
        deletedKeys += 1;
      }
    });

    return deletedKeys;
  }

  public close(): void {
    this.closed = true;
  }
}
