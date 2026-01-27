import { z } from 'zod';

export const CachedRateLimitSchema = z.object({
  totalRequests: z.number(),
  firstRequest: z.coerce.date(),
});

export const cachedRateLimitRecordSchema = z.record(z.string(), CachedRateLimitSchema);

export type CachedRateLimitRecord = z.infer<typeof cachedRateLimitRecordSchema>;
export type CachedRateLimit = z.infer<typeof CachedRateLimitSchema>;
