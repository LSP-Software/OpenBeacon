import { z } from "zod";

export const rateLimitMetaSchema = z
  .object({
    limit: z.number().int().positive(),
    windowMs: z.number().int().positive(),
    cost: z.number().int().positive().optional(),
    namespace: z.string().min(1).optional(),
    scope: z.literal("server").optional(),
  })
  .strict();

export const defaultRateLimitMeta = {
  limit: 60,
  windowMs: 60_000,
} satisfies z.infer<typeof rateLimitMetaSchema>;

export class RateLimitContextError extends Error {}
