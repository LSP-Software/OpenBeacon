import type { RestManager } from '@discordeno/rest';
import type { Camelize, DiscordMemberWithUser } from '@discordeno/types';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type { CachedMember } from '../types/member';

export class MemberCache {
  private prefix: string;
  private redis: Redis;
  private rest: RestManager;
  private ttl = 60 * 60 * 24; // 1 day

  constructor(redis: Redis, variant: VARIANTS, botId: string, rest: RestManager) {
    this.prefix = `${variant}:${botId}:guild`;
    this.redis = redis;
    this.rest = rest;
  }

  getHashKey = (guildId: string) => `${this.prefix}:${guildId}:members`;

  async get({ guildId, memberId, fetchOnNotFound }: { guildId: string; memberId: string; fetchOnNotFound: boolean }) {
    const key = this.getHashKey(guildId);

    const data = await this.redis.hget(key, memberId);
    if (!data || !Object.keys(data).length) {
      if (!fetchOnNotFound) return;

      const rawMember = await this.rest.getMember(guildId, memberId);
      const member = {
        id: rawMember.user.id,
        name: rawMember.user.username,
        roleIds: rawMember.roles,
        avatar: rawMember.user.avatar,
      };

      await this.create(guildId, memberId, member);
      return member;
    }
    await this.redis.expire(this.getHashKey(guildId), this.ttl);
    return JSON.parse(data) as CachedMember;
  }

  async getMany({
    guildId,
    userIds,
    GATEWAY_API_URL,
    GATEWAY_API_PORT,
    GATEWAY_API_AUTH,
  }: {
    guildId: string;
    userIds: string[];
    GATEWAY_API_URL: string;
    GATEWAY_API_PORT: number;
    GATEWAY_API_AUTH: string;
  }) {
    if (!userIds.length) return [];
    const key = this.getHashKey(guildId);

    const dedupedUserIds = Array.from(new Set(userIds));

    const data = await this.redis.hmget(key, ...dedupedUserIds);
    if (!data || !Object.keys(data).length) return [];

    const cachedMembers = data
      .map((member) => {
        if (!member) return;
        return JSON.parse(member);
      })
      .filter(Boolean) as CachedMember[];

    const missingUserIds = new Set(dedupedUserIds.filter((id) => !cachedMembers.find((m) => m.id === id)));

    if (!missingUserIds.size) return cachedMembers;

    const response = await fetch(`${GATEWAY_API_URL}:${GATEWAY_API_PORT}/request-members`, {
      method: 'POST',
      body: JSON.stringify({
        guildId: guildId,
        userIds: [...missingUserIds],
      }),
      headers: {
        authorization: GATEWAY_API_AUTH,
        'Content-Type': 'application/json',
      },
    }).catch((e) => console.error('Failed to fetch members from gateway', e));

    const body = await response?.json().catch(() => null);
    const fetchedMembers: Camelize<DiscordMemberWithUser>[] = body?.guildMembers;

    if (!fetchedMembers) return cachedMembers;

    const members = fetchedMembers.map((member) => ({
      id: member.user.id,
      name: member.user.username,
      roleIds: member.roles,
      avatar: `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.webp`,
    }));

    await this.createMany(guildId, members);
    await this.redis.expire(key, this.ttl);

    return [...cachedMembers, ...members];
  }

  async create(guildId: string, memberId: string, data: CachedMember) {
    const key = this.getHashKey(guildId);

    const pipeline = this.redis.pipeline();
    pipeline.hset(key, memberId, JSON.stringify(data));
    pipeline.expire(key, this.ttl);
    await pipeline.exec();

    return data;
  }

  async createMany(guildId: string, members: CachedMember[]) {
    const memberData = members.reduce<Record<string, string>>((acc, member) => {
      acc[member.id] = JSON.stringify(member);
      return acc;
    }, {});

    const pipeline = this.redis.pipeline();
    pipeline.hset(this.getHashKey(guildId), memberData);
    pipeline.expire(this.getHashKey(guildId), this.ttl);
    await pipeline.exec();
  }
}
