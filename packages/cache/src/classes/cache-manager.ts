import type { DatabaseClient } from "@openbeacon/database";
import type { RedisClient } from "bun";
import { RateLimitCache } from "../caches/rate-limit.ts";

export class CacheManager {
  redis: RedisClient;
  db?: DatabaseClient;
  prefix: string;
  rateLimit: RateLimitCache;

  constructor({
    redis,
    db,
    prefix,
  }: {
    redis: RedisClient;
    db?: DatabaseClient;
    prefix: string;
  }) {
    this.redis = redis;
    if (db !== undefined) {
      this.db = db;
    }
    this.prefix = prefix;
    this.rateLimit = new RateLimitCache(redis, prefix);
  }
}
