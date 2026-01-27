import type { RestManager } from '@discordeno/bot';
import type { PrismaClient } from 'database';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import { type CachedGuild, CachedGuildSchema } from '../types/guild';
import { getPremiumStatus } from '../utils/getPremiumStatus';

export class GuildCache {
  private prefix: string;
  private redis: Redis;
  private rest: RestManager;
  private db: PrismaClient;

  constructor(redis: Redis, variant: VARIANTS, botId: string, rest: RestManager, db: PrismaClient) {
    this.prefix = `${variant}:${botId}:guild`;
    this.redis = redis;
    this.rest = rest;
    this.db = db;
  }

  async get(guildId: string, fetchOnNotFound = false): Promise<CachedGuild | undefined> {
    const data = await this.redis.hgetall(`${this.prefix}:${guildId}`);

    if (!data || !Object.keys(data).length) {
      if (!fetchOnNotFound) return;
      const guild = await this.rest.getGuild(guildId);
      const premium = await getPremiumStatus(this.db, guildId);
      return await this.create({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount ?? 0,
        icon: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`,
        premium,
        ownerId: guild.ownerId,
      });
    }

    const cachedGuild = await CachedGuildSchema.parseAsync(data);
    const subscription = await getPremiumStatus(this.db, cachedGuild.id);
    cachedGuild.premium = subscription;
    cachedGuild.icon = `https://cdn.discordapp.com/icons/${cachedGuild.id}/${cachedGuild.icon}.png`;
    return cachedGuild;
  }

  async count() {
    return await this.redis.scard(`${this.prefix}:ids`);
  }

  async idExists(id: string): Promise<boolean> {
    const exists = await this.redis.sismember(`${this.prefix}:ids`, id);
    return exists === 1;
  }

  async getIdsInSet(ids: string[]): Promise<string[]> {
    const pipeline = this.redis.pipeline();

    for (const id of ids) {
      pipeline.sismember('guilds:ids', id);
    }

    const results = await pipeline.exec();
    if (!results) return [];

    return ids.filter((_, index) => results[index]?.[1] === 1);
  }

  async create(guild: CachedGuild) {
    await CachedGuildSchema.parseAsync(guild);
    const pipeline = this.redis.pipeline();
    pipeline.sadd('guilds:ids', guild.id);
    pipeline.hmset(`${this.prefix}:${guild.id}`, guild);
    pipeline.incrby('users:count', guild.memberCount);

    await pipeline.exec();

    return guild;
  }

  async registerMany(guildIds: string[]) {
    if (guildIds.length === 0) return;
    await this.redis.sadd(`${this.prefix}:ids`, ...guildIds);
  }

  async delete(guildId: string) {
    const cachedGuild = await this.get(guildId);
    const pipeline = this.redis.pipeline();

    pipeline.del(`${this.prefix}:${guildId}:channels`);
    pipeline.del(`${this.prefix}:${guildId}:roles`);
    pipeline.del(`${this.prefix}:${guildId}:members`);
    pipeline.srem(`${this.prefix}:ids`, guildId);
    if (cachedGuild?.memberCount) {
      pipeline.incrby('users:count', cachedGuild.memberCount * -1);
    }

    await pipeline.exec();
  }

  async deleteAll() {
    const guildIds = await this.redis.smembers(`${this.prefix}:ids`);
    const pipeline = this.redis.pipeline();

    for (const guildId of guildIds) {
      pipeline.del(`${this.prefix}:${guildId}:channels`);
      pipeline.del(`${this.prefix}:${guildId}:roles`);
      pipeline.del(`${this.prefix}:${guildId}:members`);
    }

    pipeline.del(`${this.prefix}:ids`);

    await pipeline.exec();
  }

  async userCount() {
    return Number.parseInt((await this.redis.get('users:count')) ?? '0') || 0;
  }
}
