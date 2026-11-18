import { z } from "zod";

const rateLimitIdentifierSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("userId"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("email"),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("deviceGroup"),
    deviceId: z.string().min(1),
    groupId: z.string().min(1),
  }),
  z.object({
    type: z.literal("server"),
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

export const redisUrlSchema = z.url().refine(
  (value) => {
    if (!URL.canParse(value)) return false;
    const parsed = new URL(value);
    return parsed.protocol === "redis:" || parsed.protocol === "rediss:";
  },
  { message: "redisUrl must use redis:// or rediss://" },
);

export const redisHashSecretSchema = z.string().trim().min(32);

export const openBeaconCacheOptionsSchema = z
  .object({
    redisUrl: redisUrlSchema,
    hashSecret: redisHashSecretSchema.optional(),
    keyPrefix: z.string().min(1).optional(),
    now: z
      .custom<() => number>((value): value is () => number => typeof value === "function")
      .optional(),
  })
  .strict();

export type OpenBeaconCacheOptions = z.infer<typeof openBeaconCacheOptionsSchema>;
export type RateLimitConsumeInput = z.infer<typeof rateLimitConsumeInputSchema>;
export type RateLimitIdentifier = z.infer<typeof rateLimitIdentifierSchema>;
export type RateLimitPeekInput = z.infer<typeof rateLimitPeekInputSchema>;
export type RateLimitResetInput = z.infer<typeof rateLimitResetInputSchema>;
