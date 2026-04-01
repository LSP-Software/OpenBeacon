import { z } from "zod";

export const rateLimitMetaSchema = z
  .object({
    limit: z.number().int().positive(),
    windowMs: z.number().int().positive(),
    cost: z.number().int().positive().optional(),
  })
  .strict();

export const rateLimitErrorCauseSchema = z
  .object({
    limit: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
    retryAfterMs: z.number().int().nonnegative(),
    resetAfterMs: z.number().int().nonnegative(),
  })
  .strict();

export const defaultRateLimitMeta = {
  limit: 60,
  windowMs: 60_000,
} satisfies z.infer<typeof rateLimitMetaSchema>;
