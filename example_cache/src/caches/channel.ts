import { packOverwrites, type RestManager } from '@discordeno/bot';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type { CachedChannel } from '../types/channel';

export class ChannelCache {
  private prefix: string;
  private redis: Redis;
  private rest: RestManager;
  private ttl = 60 * 60 * 24; // 1 day

  constructor(redis: Redis, variant: VARIANTS, botId: string, rest: RestManager) {
    this.prefix = `${variant}:${botId}:guild`;
    this.redis = redis;
    this.rest = rest;
  }

  getHashKey = (guildId: string) => `${this.prefix}:${guildId}:channels`;

  async get(guildId: string, channelId: string | null | undefined) {
    if (!channelId) return null;

    const data = await this.redis.hget(this.getHashKey(guildId), channelId);
    const channelsLength = await this.redis.hlen(this.getHashKey(guildId));
    if (!data || !Object.keys(data).length) {
      if (channelsLength) return;
      const channels = await this.recacheChannels(guildId);
      return channels.find((channel) => channel.id === channelId);
    }
    await this.redis.expire(this.getHashKey(guildId), this.ttl);

    return JSON.parse(data) as CachedChannel;
  }

  async create(guildId: string, channelId: string, data: CachedChannel) {
    const channelsLength = await this.redis.hlen(this.getHashKey(guildId));
    if (!channelsLength) return;

    const pipeline = this.redis.pipeline();
    pipeline.hset(this.getHashKey(guildId), channelId, JSON.stringify(data));
    pipeline.expire(this.getHashKey(guildId), this.ttl);
    await pipeline.exec();

    return data;
  }

  async createMany(guildId: string, channels: CachedChannel[]) {
    if (!channels.length) return;
    const channelData = channels.reduce<Record<string, string>>((acc, channel) => {
      acc[channel.id] = JSON.stringify(channel);
      return acc;
    }, {});

    const pipeline = this.redis.pipeline();

    pipeline.hset(this.getHashKey(guildId), channelData);
    pipeline.expire(this.getHashKey(guildId), this.ttl);
    await pipeline.exec();

    return channels;
  }

  async delete(guildId: string, channelId: string) {
    await this.redis.hdel(this.getHashKey(guildId), channelId);
  }

  async getAll(guildId: string) {
    const data = await this.redis.hgetall(this.getHashKey(guildId));
    const channelsLength = await this.redis.hlen(this.getHashKey(guildId));
    if (!data || !Object.keys(data).length) {
      if (channelsLength) return [];
      const channels = await this.recacheChannels(guildId);
      return channels;
    }
    await this.redis.expire(this.getHashKey(guildId), this.ttl);

    return Object.values(data).map((value) => JSON.parse(value)) as CachedChannel[];
  }

  async recacheChannels(guildId: string) {
    console.log(this.rest.applicationId.toString());
    console.log(this.rest.applicationId.toString());
    console.log(this.rest.applicationId.toString());
    console.log(this.rest.applicationId.toString());
    const rawChannels = await this.rest.getChannels(guildId);

    const channels = rawChannels.map((channel) => {
      return {
        id: channel.id,
        name: channel.name ?? 'N/A',
        type: channel.type,
        internalOverwrites:
          channel?.permissionOverwrites?.map((o) => {
            return packOverwrites(o.allow ?? '0', o.deny ?? '0', o.id, o.type).toString();
          }) ?? [],
        parentId: channel.parentId ?? null,
      };
    });

    await this.createMany(guildId, channels);
    return channels;
  }
}
