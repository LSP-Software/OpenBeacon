import { type PrismaClient, VerificationType } from 'database';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import { type CachedVerificationSettings, CachedVerificationSettingsSchema } from '../types/verificationSettings';
import { isGuildPremium } from '../utils/isGuildPremium';

const defaultSettings: Omit<CachedVerificationSettings, 'guildId'> = {
  enabled: false,
  blockVPNs: false,
  geoLimitingEnabled: false,
  geoLimits: [],
  type: VerificationType.VOTE,
  timeout: 360,
  minimumAccountAgeEnabled: false,
  minimumAccountAgeMS: 0,
};
export class VerificationSettingsCache {
  private prefix: string;
  private redis: Redis;
  private db: PrismaClient;
  private ttl = 60 * 60 * 24; // 1 day

  constructor(redis: Redis, db: PrismaClient, variant: VARIANTS, botId: string) {
    this.prefix = `${variant}:${botId}:guild`;
    this.redis = redis;
    this.db = db;
  }

  getKey = (guildId: string) => `${this.prefix}:${guildId}:verificationSettings`;

  create = async (settings: CachedVerificationSettings) => {
    const data = await CachedVerificationSettingsSchema.parseAsync(settings);
    return await this.redis.set(this.getKey(settings.guildId), JSON.stringify(data), 'EX', this.ttl);
  };

  get = async (guildId: string): Promise<CachedVerificationSettings> => {
    let value = await this.redis.get(this.getKey(guildId));

    if (!value) {
      const dbSettings = await this.db.verificationSettings.findFirst({ where: { guildId } });
      let settings: CachedVerificationSettings;
      if (!dbSettings || dbSettings.guildId !== guildId) {
        settings = { ...defaultSettings, guildId } as CachedVerificationSettings;
      } else {
        settings = {
          guildId: dbSettings.guildId,
          enabled: dbSettings.enabled,
          blockVPNs: dbSettings.blockVPNs,
          geoLimitingEnabled: dbSettings.geoLimitingEnabled,
          geoLimits: dbSettings.geoLimits,
          roleId: dbSettings.roleId ?? undefined,
          channelId: dbSettings.channelId ?? undefined,
          messageId: dbSettings.messageId ?? undefined,
          type: dbSettings.type,
          timeout: dbSettings.timeout,
          minimumAccountAgeEnabled: dbSettings.minimumAccountAgeEnabled,
          minimumAccountAgeMS: Number(dbSettings.minimumAccountAgeMS),
        } as CachedVerificationSettings;
      }

      await this.create(settings);
      value = await this.redis.get(this.getKey(guildId));
    }

    if (!value) return { ...defaultSettings, guildId };

    const jsoned = JSON.parse(value as string);
    const settings = await CachedVerificationSettingsSchema.parseAsync(jsoned);
    const isPremium = await isGuildPremium(guildId, this.db);

    if (!isPremium) {
      settings.type = defaultSettings.type;
      settings.timeout = defaultSettings.timeout;
      settings.blockVPNs = defaultSettings.blockVPNs;
      settings.geoLimitingEnabled = defaultSettings.geoLimitingEnabled;
      settings.geoLimits = defaultSettings.geoLimits;
    }

    return settings;
  };

  delete = async (guildId: string) => {
    return await this.redis.del(this.getKey(guildId));
  };
}
