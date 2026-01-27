import type { RestManager } from '@discordeno/bot';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type { CachedRole } from '../types/role';

export class RoleCache {
  private prefix: string;
  private redis: Redis;
  private rest: RestManager;
  private ttl = 60 * 60 * 24;

  constructor(redis: Redis, variant: VARIANTS, botId: string, rest: RestManager) {
    this.prefix = `${variant}:${botId}:guild`;
    this.redis = redis;
    this.rest = rest;
  }

  getHashKey = (guildId: string) => `${this.prefix}:${guildId}:roles`;

  async get(guildId: string, roleId: string | undefined | null) {
    if (!roleId) return null;
    const data = await this.redis.hget(this.getHashKey(guildId), roleId);
    const rolesLength = await this.redis.hlen(this.getHashKey(guildId));
    if (!data || !Object.keys(data).length) {
      if (rolesLength) return;
      const roles = await this.recacheRoles(guildId);
      return roles.find((role) => role.id === roleId);
    }
    await this.redis.expire(this.getHashKey(guildId), this.ttl);
    return JSON.parse(data) as CachedRole;
  }

  async create(guildId: string, roleId: string, data: CachedRole) {
    const rolesLength = await this.redis.hlen(this.getHashKey(guildId));
    if (!rolesLength) return;

    const pipeline = this.redis.pipeline();
    pipeline.hset(this.getHashKey(guildId), roleId, JSON.stringify(data));
    pipeline.expire(this.getHashKey(guildId), this.ttl);
    await pipeline.exec();
  }

  async createMany(guildId: string, roles: CachedRole[]) {
    if (!roles.length) return;
    const roleData = roles.reduce<Record<string, string>>((acc, role) => {
      acc[role.id] = JSON.stringify(role);
      return acc;
    }, {});

    const pipeline = this.redis.pipeline();

    pipeline.hset(this.getHashKey(guildId), roleData);
    pipeline.expire(this.getHashKey(guildId), this.ttl);
    await pipeline.exec();
    return roles;
  }

  async delete(guildId: string, roleId: string) {
    await this.redis.hdel(this.getHashKey(guildId), roleId);
  }

  async getAll(guildId: string) {
    const data = await this.redis.hgetall(this.getHashKey(guildId));
    const rolesLength = await this.redis.hlen(this.getHashKey(guildId));

    if (!data || !Object.keys(data).length) {
      if (rolesLength) return [];
      const roles = await this.recacheRoles(guildId);
      return roles;
    }
    await this.redis.expire(this.getHashKey(guildId), this.ttl);

    return Object.values(data).map((value) => JSON.parse(value)) as CachedRole[];
  }

  async recacheRoles(guildId: string) {
    const rawRoles = await this.rest.getRoles(guildId);
    if (!rawRoles) return [];

    const roles = rawRoles.map((role) => {
      return {
        id: role.id,
        name: role.name,
        color: role.color.toString(),
        permissions: role.permissions,
        position: role.position,
        managed: role.managed,
      };
    });

    await this.createMany(guildId, roles);
    return roles;
  }
}
