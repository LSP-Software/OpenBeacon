import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  type CacheDeserializer,
  type CacheSerializer,
  cacheClient,
  type GetOrSetOptions,
  getFromCache,
  getOrSet,
  setInCache,
} from "@openbeacon/cache";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  count: number;
};

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await cacheClient.connect();
  }

  async onModuleDestroy(): Promise<void> {
    cacheClient.close();
  }

  getClient() {
    return cacheClient;
  }

  async get<T>(key: string, deserialize?: CacheDeserializer<T>): Promise<T | null> {
    return getFromCache(key, deserialize);
  }

  async set<T>(
    key: string,
    value: T,
    options?: {
      ttlSeconds?: number;
      serialize?: CacheSerializer<T>;
    },
  ): Promise<void> {
    await setInCache(key, value, options);
  }

  async getOrSet<T>(key: string, options: GetOrSetOptions<T>): Promise<T> {
    return getOrSet(key, options);
  }

  async rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const count = await cacheClient.incr(key);
    if (count === 1) {
      await cacheClient.expire(key, windowSeconds);
    }

    const ttl = await cacheClient.ttl(key);
    const resetSeconds = ttl > 0 ? ttl : windowSeconds;
    const remaining = Math.max(0, limit - count);

    return {
      allowed: count <= limit,
      limit,
      remaining,
      resetSeconds,
      count,
    };
  }
}
