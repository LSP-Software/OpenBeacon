import { z } from 'zod';

export const CachedGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberCount: z.coerce.number(),
  icon: z.string().nullable(),
  premium: z.coerce.boolean().optional(),
  ownerId: z.string(),
});

export const CachedGuildArraySchema = CachedGuildSchema.array();
export type CachedGuild = z.infer<typeof CachedGuildSchema>;
