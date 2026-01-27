import { z } from "zod";

export const CachedRateLimitSchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  firstRequest: z.coerce.date(),
});

export type CachedRateLimit = z.infer<typeof CachedRateLimitSchema>;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  totalRequests: number;
};
