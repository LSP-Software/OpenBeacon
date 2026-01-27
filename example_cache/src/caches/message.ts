import type { RestManager } from '@discordeno/bot';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type { CachedMessage } from '../types/message';

export class MessageCache {
  private prefix: string;
  private redis: Redis;
  private rest: RestManager;
  private ttl = 60; // 60 seconds

  constructor(redis: Redis, variant: VARIANTS, botId: string, rest: RestManager) {
    this.prefix = `${variant}:${botId}:guild`;
    this.redis = redis;
    this.rest = rest;
  }

  getHashKey = (guildId: string) => `${this.prefix}:${guildId}:messages`;

  async get({
    guildId,
    channelId,
    messageId,
  }: {
    guildId: string;
    channelId: string;
    messageId: string | undefined | null;
  }) {
    if (!messageId) return null;
    const data = await this.redis.hget(this.getHashKey(guildId), messageId);
    if (!data || !Object.keys(data).length) {
      const message = await this.recacheMessage(channelId, messageId);
      return message;
    }

    await this.redis.expire(this.getHashKey(guildId), this.ttl);
    return JSON.parse(data) as CachedMessage;
  }

  async create(guildId: string, messageId: string, data: CachedMessage) {
    const pipeline = this.redis.pipeline();
    pipeline.hset(this.getHashKey(guildId), messageId, JSON.stringify(data));
    pipeline.expire(this.getHashKey(guildId), this.ttl);
    await pipeline.exec();
  }

  async delete(guildId: string, messageId: string) {
    await this.redis.hdel(this.getHashKey(guildId), messageId);
  }

  async recacheMessage(channelId: string, messageId: string) {
    const rawMessage = await this.rest.getMessage(channelId, messageId).catch(() => undefined);
    if (!rawMessage) return undefined;

    const message = {
      id: rawMessage.id,
    };

    await this.create(channelId, messageId, message);

    return message;
  }
}
