import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import { type CachedRateLimit, CachedRateLimitSchema } from '../types/rateLimit';

export class RateLimitCache {
  private prefix: string;
  private redis: Redis;
  private ttl = 300;

  constructor(redis: Redis, variant: VARIANTS) {
    this.prefix = `${variant}`;
    this.redis = redis;
  }

  getKey = (ip: string) => `${this.prefix}:rateLimit:${ip}`;

  async newRequest({ ip, path }: { ip: string; path: string }) {
    const key = this.getKey(ip);
    const rateLimit = await this.redis.hget(key, path);
    if (!rateLimit) {
      return await this.create({ ip, path });
    }
    const pipeline = this.redis.pipeline();
    const parsedRateLimit = await CachedRateLimitSchema.parseAsync(JSON.parse(rateLimit));

    const isOverOneMinuteAgo = Date.now() - parsedRateLimit.firstRequest.getTime() > 60000;
    if (isOverOneMinuteAgo) {
      return await this.create({ ip, path });
    }

    pipeline.hset(
      key,
      path,
      JSON.stringify({
        totalRequests: parsedRateLimit.totalRequests + 1,
        firstRequest: parsedRateLimit.firstRequest.getTime(),
      }),
    );

    pipeline.expire(key, this.ttl);
    await pipeline.exec();

    return parsedRateLimit;
  }

  async create({ ip, path }: { ip: string; path: string }) {
    const key = this.getKey(ip);

    const pipeline = this.redis.pipeline();
    const firstRequest = new Date();

    pipeline.hset(key, path, JSON.stringify({ totalRequests: 1, firstRequest: firstRequest.getTime() }));
    pipeline.expire(key, this.ttl);
    await pipeline.exec();

    return { totalRequests: 1, firstRequest } satisfies CachedRateLimit;
  }
}
