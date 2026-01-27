import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  type CacheDeserializer,
  type CacheSerializer,
  type GetOrSetOptions,
  getFromCache,
  getOrSet,
  setInCache,
} from "../cache.js";
import { CacheManager } from "../classes/cache-manager.js";
import { cacheClient } from "../client.js";
import { env } from "../env.js";
import type { RateLimitResult } from "../types/rate-limit.js";

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private manager: CacheManager;

  constructor() {
    this.manager = new CacheManager({
      redis: cacheClient,
      prefix: env.CACHE_PREFIX,
    });
  }

  async onModuleInit(): Promise<void> {
    await cacheClient.connect();
  }

  async onModuleDestroy(): Promise<void> {
    cacheClient.close();
  }

  getManager(): CacheManager {
    return this.manager;
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

  async rateLimit(options: {
    ip: string;
    path: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitResult> {
    return this.manager.rateLimit.check(options);
  }
}
