import { VerificationType } from 'database';
import { z } from 'zod';

export const CachedVerificationSettingsSchema = z.object({
  guildId: z.string(),
  enabled: z.boolean(),
  roleId: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
  type: z.enum(VerificationType),
  timeout: z.number(),
});

export const CachedUserGuildArraySchema = CachedVerificationSettingsSchema.array();
export type CachedVerificationSettings = z.infer<typeof CachedVerificationSettingsSchema>;
