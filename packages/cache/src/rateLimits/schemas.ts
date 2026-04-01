import type { RedisOptions } from "bun";
import { z } from "zod";

export const rateLimitIdentifierSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("userId"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("ip"),
    value: z.string().min(1),
  }),
]);

export const rateLimitPeekInputSchema = z.object({
  namespace: z.string().min(1),
  identifier: rateLimitIdentifierSchema,
  limit: z.number().int().positive(),
  windowMs: z.number().int().positive(),
  cost: z.number().int().nonnegative().optional(),
});

export const rateLimitConsumeInputSchema = z.object({
  namespace: z.string().min(1),
  identifier: rateLimitIdentifierSchema,
  limit: z.number().int().positive(),
  windowMs: z.number().int().positive(),
  cost: z.number().int().positive().optional(),
});

export const rateLimitResetInputSchema = z.object({
  namespace: z.string().min(1),
  identifier: rateLimitIdentifierSchema,
});

export const redisOptionsSchema = z
  .object({
    connectionTimeout: z.number().int().nonnegative().optional(),
    idleTimeout: z.number().int().nonnegative().optional(),
    autoReconnect: z.boolean().optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    enableOfflineQueue: z.boolean().optional(),
    tls: z
      .union([
        z.boolean(),
        z.custom<RedisOptions["tls"]>(
          (value) => value !== null && typeof value === "object" && !Array.isArray(value),
        ),
      ])
      .optional(),
    enableAutoPipelining: z.boolean().optional(),
  })
  .strict();

export const redisUrlSchema = z.url().refine(
  (value) => {
    const parsed = new URL(value);
    return parsed.protocol === "redis:" || parsed.protocol === "rediss:";
  },
  { message: "redisUrl must use redis:// or rediss://" },
);

export const openBeaconCacheOptionsSchema = z
  .object({
    redisUrl: redisUrlSchema,
    keyPrefix: z.string().min(1).optional(),
    redisOptions: redisOptionsSchema.optional(),
    now: z.custom<() => number>((value) => typeof value === "function").optional(),
  })
  .strict();

export type OpenBeaconCacheOptions = z.infer<typeof openBeaconCacheOptionsSchema>;
export type RateLimitConsumeInput = z.infer<typeof rateLimitConsumeInputSchema>;
export type RateLimitIdentifier = z.infer<typeof rateLimitIdentifierSchema>;
export type RateLimitPeekInput = z.infer<typeof rateLimitPeekInputSchema>;
export type RateLimitResetInput = z.infer<typeof rateLimitResetInputSchema>;
