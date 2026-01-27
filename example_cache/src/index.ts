import { CacheManager } from './classes/CacheManager';
import type { CachedBotStats } from './types/botStats';
import type { CachedChannel } from './types/channel';
import type { CachedCommand } from './types/command';
import type { CachedGuild } from './types/guild';
import type { CachedGuildMemberWithUser, CachedMember } from './types/member';
import type { CachedMessage } from './types/message';
import type { CachedRole } from './types/role';
import {
  type CachedStripePricing,
  type PricingTier,
  PricingTierSchema,
  type StripeTier,
  StripeTierSchema,
} from './types/stripePrice';
import type { CachedUserGuild } from './types/userGuild';
import type { CachedVerificationSettings } from './types/verificationSettings';

export default CacheManager;
export type {
  CachedBotStats,
  CachedChannel,
  CachedCommand,
  CachedGuild,
  CachedGuildMemberWithUser,
  CachedMember,
  CachedMessage,
  CachedRole,
  CachedStripePricing,
  CachedUserGuild,
  CachedVerificationSettings,
  PricingTier,
  StripeTier,
};

export { PricingTierSchema, StripeTierSchema };
export { getPremiumStatus } from './utils/getPremiumStatus';
