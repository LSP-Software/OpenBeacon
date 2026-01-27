import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import { type CachedUserGuild, CachedUserGuildArraySchema } from '../types/userGuild';

export class UserGuildsCache {
  private prefix: string;
  private redis: Redis;
  private ttl = 300;

  constructor(redis: Redis, variant: VARIANTS) {
    this.prefix = `${variant}:userGuilds`;
    this.redis = redis;
  }

  create = async (userId: string, guilds: CachedUserGuild[]) => {
    const data = await CachedUserGuildArraySchema.parseAsync(guilds);

    const pipeline = this.redis.pipeline();
    pipeline.hset(this.prefix, userId, JSON.stringify(data));
    pipeline.hexpire(this.prefix, this.ttl, 'FIELDS', 1, userId);
    await pipeline.exec();

    return data;
  };

  get = async (userId: string) => {
    const value = await this.redis.hget(this.prefix, userId);
    if (!value) return null;

    const parsed = JSON.parse(value as string);
    return await CachedUserGuildArraySchema.parseAsync(parsed);
  };

  delete = async (userId: string) => {
    return await this.redis.hdel(this.prefix, userId);
  };

  deleteByGuildId = async (guildId: string) => {
    const hashKey = this.prefix;

    const allUserGuilds = await this.redis.hgetall(hashKey);

    if (!allUserGuilds || !Object.keys(allUserGuilds).length) {
      return [];
    }

    const usersToDelete: string[] = [];

    for (const [userId, guildsData] of Object.entries(allUserGuilds)) {
      try {
        const guilds = await CachedUserGuildArraySchema.parseAsync(JSON.parse(guildsData));
        const hasGuild = guilds.some((guild) => guild.id === guildId);

        if (hasGuild) {
          usersToDelete.push(userId);
        }
      } catch (_error) {
        usersToDelete.push(userId);
      }
    }

    if (usersToDelete.length > 0) {
      await this.redis.hdel(hashKey, ...usersToDelete);
    }

    return usersToDelete;
  };
}
