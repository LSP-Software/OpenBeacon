import { z } from 'zod';

export const CachedUserGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  owner: z.boolean(),
  permissions: z.number().transform((val) => Number(val)),
  memberCount: z
    .string()
    .transform((val) => (val === null ? 0 : Number(val)))
    .nullable(),
});

export const CachedUserGuildArraySchema = CachedUserGuildSchema.array();
export type CachedUserGuild = z.infer<typeof CachedUserGuildSchema>;
