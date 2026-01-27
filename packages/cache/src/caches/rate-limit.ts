import type { RedisClient } from "bun";
import {
  type CachedRateLimit,
  CachedRateLimitSchema,
  type RateLimitResult,
} from "../types/rate-limit.ts";

export class RateLimitCache {
  private prefix: string;
  private redis: RedisClient;

  constructor(redis: RedisClient, prefix: string) {
    this.redis = redis;
    this.prefix = prefix;
  }

  getKey = (ip: string) => `${this.prefix}:rateLimit:${ip}`;

  async check({
    ip,
    path,
    limit,
    windowSeconds,
  }: {
    ip: string;
    path: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitResult> {
    const key = this.getKey(ip);
    const stored = await this.redis.hget(key, path);
    if (!stored) {
      const created = await this.create({ key, path, windowSeconds });
      return this.toResult(created, limit, windowSeconds);
    }

    const parsed = await CachedRateLimitSchema.parseAsync(JSON.parse(stored));
    const elapsed = Date.now() - parsed.firstRequest.getTime();
    if (elapsed > windowSeconds * 1000) {
      const created = await this.create({ key, path, windowSeconds });
      return this.toResult(created, limit, windowSeconds);
    }

    const updated = {
      totalRequests: parsed.totalRequests + 1,
      firstRequest: parsed.firstRequest,
    } satisfies CachedRateLimit;

    await Promise.all([
      this.redis.hset(
        key,
        path,
        JSON.stringify({
          totalRequests: updated.totalRequests,
          firstRequest: updated.firstRequest.getTime(),
        }),
      ),
      this.redis.expire(key, windowSeconds),
    ]);

    return this.toResult(updated, limit, windowSeconds);
  }

  private async create({
    key,
    path,
    windowSeconds,
  }: {
    key: string;
    path: string;
    windowSeconds: number;
  }): Promise<CachedRateLimit> {
    const firstRequest = new Date();
    const payload = { totalRequests: 1, firstRequest: firstRequest.getTime() };

    await Promise.all([
      this.redis.hset(key, path, JSON.stringify(payload)),
      this.redis.expire(key, windowSeconds),
    ]);

    return { totalRequests: 1, firstRequest } satisfies CachedRateLimit;
  }

  private toResult(
    rateLimit: CachedRateLimit,
    limit: number,
    windowSeconds: number,
  ): RateLimitResult {
    const remaining = Math.max(0, limit - rateLimit.totalRequests);

    return {
      allowed: rateLimit.totalRequests <= limit,
      limit,
      remaining,
      resetSeconds: windowSeconds,
      totalRequests: rateLimit.totalRequests,
    };
  }
}
