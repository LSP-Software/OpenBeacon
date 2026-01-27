import type { RestManager } from '@discordeno/rest';
import type { PrismaClient } from 'database';
import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import { BotStatsCache } from '../caches/botStats';
import { ChannelCache } from '../caches/channel';
import { CommandCache } from '../caches/command';
import { GuildCache } from '../caches/guild';
import { GuildMembersCache } from '../caches/guildMembers';
import { MemberCache } from '../caches/member';
import { MessageCache } from '../caches/message';
import { RateLimitCache } from '../caches/ratelimit';
import { RoleCache } from '../caches/role';
import { StripePriceCache } from '../caches/stripePrice';
import { UserGuildsCache } from '../caches/userGuilds';
import { VerificationRequestCache } from '../caches/verificationRequest';
import { VerificationSettingsCache } from '../caches/verificationSettings';
import { VotesCache } from '../caches/votes';

export class CacheManager {
  rest: RestManager;
  redis: Redis;
  variant: VARIANTS;
  db: PrismaClient;

  botStats: BotStatsCache;

  channels: ChannelCache;
  commands: CommandCache;
  guilds: GuildCache;
  guildMembers: GuildMembersCache;
  members: MemberCache;
  roles: RoleCache;
  userGuilds: UserGuildsCache;
  messages: MessageCache;

  verificationSettings: VerificationSettingsCache;
  verificationRequest: VerificationRequestCache;
  votes: VotesCache;
  stripePrice: StripePriceCache;

  rateLimit: RateLimitCache;

  constructor({ rest, redis, variant, db }: { rest: RestManager; redis: Redis; variant: VARIANTS; db: PrismaClient }) {
    this.rest = rest;
    this.redis = redis;
    this.variant = variant;
    this.db = db;

    const botId = rest.applicationId.toString();
    this.botStats = new BotStatsCache(redis, variant, botId);

    this.channels = new ChannelCache(redis, variant, botId, rest);
    this.commands = new CommandCache(redis, db, variant, botId);
    this.guilds = new GuildCache(redis, variant, botId, rest, db);
    this.guildMembers = new GuildMembersCache(redis, variant, botId, rest);
    this.members = new MemberCache(redis, variant, botId, rest);
    this.roles = new RoleCache(redis, variant, botId, rest);
    this.messages = new MessageCache(redis, variant, botId, rest);
    this.userGuilds = new UserGuildsCache(redis, variant);
    this.rateLimit = new RateLimitCache(redis, variant);

    this.verificationRequest = new VerificationRequestCache(redis, variant, botId, rest);
    this.verificationSettings = new VerificationSettingsCache(redis, db, variant, botId);
    this.votes = new VotesCache(redis, variant, botId);
    this.stripePrice = new StripePriceCache(redis, variant);
  }
}
