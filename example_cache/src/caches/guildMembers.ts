import type { RestManager } from '@discordeno/rest';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type { CachedGuildMemberWithUser } from '../types/member';
import { fetchAllGuildMembers } from '../utils/fetchAllGuildMembers';

export class GuildMembersCache {
  private prefix: string;
  private redis: Redis;
  private rest: RestManager;
  private ttl = 60; // 1 minute

  constructor(redis: Redis, variant: VARIANTS, botId: string, rest: RestManager) {
    this.prefix = `${variant}:${botId}:guild`;
    this.redis = redis;
    this.rest = rest;
  }

  private getAllMembersKey = (guildId: string) => `${this.prefix}:${guildId}:members:all`;

  async getAll(guildId: string): Promise<CachedGuildMemberWithUser[]> {
    const key = this.getAllMembersKey(guildId);

    const cached = await this.redis.get(key);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed as CachedGuildMemberWithUser[];
        }

        await this.redis.del(key).catch((deleteError) => {
          console.error(`Failed to delete invalid cached members for guild ${guildId}`, deleteError);
        });
      } catch (error) {
        console.error(`Failed to parse cached members for guild ${guildId}`, error);
        await this.redis.del(key).catch((deleteError) => {
          console.error(`Failed to delete corrupted cached members for guild ${guildId}`, deleteError);
        });
      }
    }

    return this.recache(guildId);
  }

  async set(guildId: string, members: CachedGuildMemberWithUser[]) {
    if (!members.length) return;

    const key = this.getAllMembersKey(guildId);

    try {
      await this.redis.set(key, JSON.stringify(members), 'EX', this.ttl);
    } catch (error) {
      console.error(`Failed to cache members for guild ${guildId}`, error);
    }
  }

  async delete(guildId: string) {
    const key = this.getAllMembersKey(guildId);

    try {
      await this.redis.del(key);
    } catch (error) {
      console.error(`Failed to delete cached members for guild ${guildId}`, error);
    }
  }

  private async recache(guildId: string): Promise<CachedGuildMemberWithUser[]> {
    const members = await fetchAllGuildMembers({
      rest: this.rest,
      guildId,
    });

    if (!members.length) {
      return [];
    }

    await this.set(guildId, members);
    return members;
  }
}
