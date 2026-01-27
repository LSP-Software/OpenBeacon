import { VerificationType } from 'database';
import { z } from 'zod';

export const CachedVerificationSettingsSchema = z.object({
  guildId: z.string(),
  enabled: z.boolean(),
  blockVPNs: z.boolean(),
  geoLimitingEnabled: z.boolean(),
  geoLimits: z.array(z.string()),
  roleId: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
  type: z.enum(VerificationType),
  timeout: z.number(),
  minimumAccountAgeEnabled: z.boolean(),
  minimumAccountAgeMS: z.preprocess((val) => (typeof val === 'bigint' ? Number(val) : val), z.number()),
});

export const CachedUserGuildArraySchema = CachedVerificationSettingsSchema.array();
export type CachedVerificationSettings = z.infer<typeof CachedVerificationSettingsSchema>;
