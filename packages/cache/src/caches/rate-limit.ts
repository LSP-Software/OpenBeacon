import type { RedisClient } from "bun";
import type { RateLimitResult } from "../types/rate-limit.ts";

export class RateLimitCache {
  private prefix: string;
  private redis: RedisClient;

  constructor(redis: RedisClient, prefix: string) {
    this.redis = redis;
    this.prefix = prefix;
  }

  getKey = (ip: string, path: string) => `${this.prefix}:rateLimit:${ip}:${path}`;

  private static readonly rateLimitScript = [
    "local key = KEYS[1]",
    "local window = tonumber(ARGV[1])",
    "local count = redis.call('INCR', key)",
    "if count == 1 then",
    "  redis.call('EXPIRE', key, window)",
    "end",
    "local ttl = redis.call('TTL', key)",
    "return { count, ttl }",
  ].join("\n");

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
    const key = this.getKey(ip, path);
    const result = (await this.redis.send("EVAL", [
      RateLimitCache.rateLimitScript,
      "1",
      key,
      windowSeconds.toString(),
    ])) as [number, number];

    const [count, ttl] = result;
    const resetSeconds = ttl > 0 ? ttl : windowSeconds;
    const remaining = Math.max(0, limit - count);

    return {
      allowed: count <= limit,
      limit,
      remaining,
      resetSeconds,
      totalRequests: count,
    };
  }
}
