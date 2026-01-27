import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type { CachedBotStats } from '../types/botStats';

export class BotStatsCache {
  private key: string;
  private redis: Redis;

  constructor(redis: Redis, variant: VARIANTS, botId: string) {
    this.key = `${variant}:${botId}:stats`;
    this.redis = redis;
  }

  upsert = async (stats: CachedBotStats) => {
    await this.redis.set(this.key, JSON.stringify(stats));
  };

  get = async (): Promise<CachedBotStats | null> => {
    const botStats = await this.redis.get(this.key);
    if (!botStats) return null;

    return JSON.parse(botStats) as CachedBotStats;
  };
}
