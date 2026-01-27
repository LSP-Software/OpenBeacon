import type { RestManager } from '@discordeno/bot';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type { VerificationRequest } from '../types/verification';

export class VerificationRequestCache {
  private prefix: string;
  private redis: Redis;
  private rest: RestManager;

  constructor(redis: Redis, variant: VARIANTS, botId: string, rest: RestManager) {
    this.prefix = `${variant}:${botId}:verificationRequestId`;
    this.redis = redis;
    this.rest = rest;
  }

  getHashKey = (verificationRequestId: string) => `${this.prefix}:${verificationRequestId}`;

  create = async ({
    userId,
    guildId,
    timeout,
    uuid,
  }: {
    userId: string;
    guildId: string;
    timeout: number;
    uuid: string;
  }) => {
    await this.redis.hmset(this.getHashKey(uuid), {
      userId,
      guildId,
      uuid,
      botId: this.rest.applicationId.toString(),
    } satisfies VerificationRequest);
    await this.redis.expire(this.getHashKey(uuid), timeout);
  };

  get = async ({ verificationRequestId }: { verificationRequestId: string }): Promise<VerificationRequest | null> => {
    const data = await this.redis.hgetall(this.getHashKey(verificationRequestId));
    if (!data || !Object.keys(data).length) return null;
    return data as unknown as VerificationRequest;
  };

  delete = async ({ verificationRequestId }: { verificationRequestId: string }) => {
    await this.redis.del(this.getHashKey(verificationRequestId));
  };
}
