import { CommandName } from 'database';
import { z } from 'zod';

export const CachedCommandSchema = z.object({
  id: z.number().optional(),
  name: z.enum(CommandName),
  enabled: z.boolean(),
  permissions: z.string(),
  updatedByName: z.string().optional(),
  updatedByImage: z.string().optional(),
  updatedAt: z.date().optional(),
});

export const CachedCommandArraySchema = CachedCommandSchema.array();
export type CachedCommand = z.infer<typeof CachedCommandSchema>;
