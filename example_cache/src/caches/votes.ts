import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';

export class VotesCache {
  private prefix: string;
  private redis: Redis;
  private ttl = 60 * 60 * 13; // 13 hours

  constructor(redis: Redis, variant: VARIANTS, botId: string) {
    this.prefix = `${variant}:${botId}:votes`;
    this.redis = redis;
  }

  getKey = (userId: string) => `${this.prefix}:${userId}`;

  create = async (userId: string) => {
    await this.redis.set(this.getKey(userId), new Date().toISOString(), 'EX', this.ttl);
  };

  get = async (userId: string): Promise<string | null> => {
    return await this.redis.get(this.getKey(userId));
  };

  delete = async (userId: string) => {
    await this.redis.del(this.getKey(userId));
  };
}
