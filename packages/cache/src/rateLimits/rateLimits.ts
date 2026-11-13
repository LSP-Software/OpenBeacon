import { createHmac } from "node:crypto";
import type { RedisLike } from "../cache/redis.ts";
import {
  type RateLimitIdentifier,
  rateLimitConsumeInputSchema,
  rateLimitPeekInputSchema,
  rateLimitResetInputSchema,
} from "./schemas.ts";
import type { RateLimitResult, WhenRedisUnavailable } from "./types.ts";

type RateLimitsDependencies = {
  hashSecret: string | undefined;
  keyPrefix: string;
  now: () => number;
  redis: RedisLike;
};

const rateLimitScript = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local should_consume = tonumber(ARGV[5])
local existing = redis.call("HMGET", key, "tokens", "lastMs")
local tokens = tonumber(existing[1])
local last_ms = tonumber(existing[2])

if tokens == nil or last_ms == nil then
  tokens = limit
  last_ms = now_ms
end

local refill_rate = limit / window_ms
if now_ms > last_ms then
  tokens = math.min(limit, tokens + ((now_ms - last_ms) * refill_rate))
  last_ms = now_ms
end

local allowed = 0
if tokens >= cost then
  allowed = 1
  if should_consume == 1 then
    tokens = math.min(limit, tokens - cost)
  end
end

local retry_after_ms = 0
if allowed == 0 then
  retry_after_ms = math.ceil((cost - tokens) / refill_rate)
end

local reset_after_ms = math.ceil(math.max(0, limit - tokens) / refill_rate)
local ttl_ms = math.max(window_ms, reset_after_ms)

redis.call("HSET", key, "tokens", tostring(tokens), "lastMs", tostring(last_ms))
redis.call("PEXPIRE", key, ttl_ms)

return {
  tostring(allowed),
  tostring(limit),
  tostring(math.max(0, math.floor(tokens))),
  tostring(retry_after_ms),
  tostring(reset_after_ms),
}
`;

const buildRateLimitKey = ({
  identifier,
  hashSecret,
  keyPrefix,
  namespace,
}: {
  identifier: RateLimitIdentifier;
  hashSecret: string | undefined;
  keyPrefix: string;
  namespace: string;
}) => {
  if (identifier.type === "userId") {
    return `${keyPrefix}:ratelimit:${namespace}:userId:${identifier.value}`;
  }
  if (!hashSecret) {
    throw new Error("Rate limiting by IP address or email address needs a hash secret.");
  }
  const hash = createHmac("sha256", hashSecret)
    .update(`${identifier.type}:${identifier.value}`)
    .digest("base64url");
  return `${keyPrefix}:ratelimit:${namespace}:${identifier.type}:${hash}`;
};

const parseRateLimitResult = (result: unknown): RateLimitResult => {
  if (!Array.isArray(result) || result.length !== 5) {
    throw new Error("Unexpected Redis rate limit response.");
  }

  const [allowed, limit, remaining, retryAfterMs, resetAfterMs] = result;

  return {
    allowed: allowed === "1" || allowed === 1,
    limit: Number(limit),
    remaining: Number(remaining),
    retryAfterMs: Number(retryAfterMs),
    resetAfterMs: Number(resetAfterMs),
  };
};

const executeRateLimitScript = async ({
  identifier,
  hashSecret,
  keyPrefix,
  limit,
  namespace,
  now,
  redis,
  shouldConsume,
  windowMs,
  cost,
}: {
  identifier: RateLimitIdentifier;
  hashSecret: string | undefined;
  keyPrefix: string;
  limit: number;
  namespace: string;
  now: () => number;
  redis: RedisLike;
  shouldConsume: boolean;
  windowMs: number;
  cost: number;
}) => {
  const key = buildRateLimitKey({ identifier, hashSecret, keyPrefix, namespace });

  const result = await redis.send("EVAL", [
    rateLimitScript,
    "1",
    key,
    String(now()),
    String(limit),
    String(windowMs),
    String(cost),
    shouldConsume ? "1" : "0",
  ]);

  return parseRateLimitResult(result);
};

const withFallback = async (
  { namespace, limit }: { namespace: string; limit: number },
  result: Promise<RateLimitResult>,
  options: WhenRedisUnavailable | undefined,
): Promise<RateLimitResult> => {
  if (!options) return result;
  return result.catch((error: unknown) => {
    const allowed = options.whenUnavailable === "allow";
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    console.error(
      `[rate-limit] Redis is unavailable${code ? ` (${code})` : ""}, so ${namespace} is ${allowed ? "allowed" : "refused"}`,
    );
    return {
      allowed,
      limit,
      remaining: allowed ? limit : 0,
      retryAfterMs: allowed ? 0 : 60_000,
      resetAfterMs: 0,
      unavailable: true,
    };
  });
};

export const createRateLimits = ({ hashSecret, keyPrefix, now, redis }: RateLimitsDependencies) => {
  return {
    peek: async (
      input: Parameters<typeof rateLimitPeekInputSchema.parse>[0],
      options?: WhenRedisUnavailable,
    ) => {
      const parsedInput = rateLimitPeekInputSchema.parse(input);

      return withFallback(
        parsedInput,
        executeRateLimitScript({
          redis,
          hashSecret,
          keyPrefix,
          now,
          ...parsedInput,
          shouldConsume: false,
          cost: 0,
        }),
        options,
      );
    },
    consume: async (
      input: Parameters<typeof rateLimitConsumeInputSchema.parse>[0],
      options?: WhenRedisUnavailable,
    ) => {
      const parsedInput = rateLimitConsumeInputSchema.parse(input);

      return withFallback(
        parsedInput,
        executeRateLimitScript({
          redis,
          hashSecret,
          keyPrefix,
          now,
          ...parsedInput,
          shouldConsume: true,
          cost: parsedInput.cost ?? 1,
        }),
        options,
      );
    },
    refund: async (input: Parameters<typeof rateLimitConsumeInputSchema.parse>[0]) => {
      const parsedInput = rateLimitConsumeInputSchema.parse(input);

      return executeRateLimitScript({
        redis,
        hashSecret,
        keyPrefix,
        now,
        ...parsedInput,
        shouldConsume: true,
        cost: -(parsedInput.cost ?? 1),
      });
    },
    reset: async (input: Parameters<typeof rateLimitResetInputSchema.parse>[0]) => {
      const parsedInput = rateLimitResetInputSchema.parse(input);

      return redis.del(
        buildRateLimitKey({
          identifier: parsedInput.identifier,
          hashSecret,
          keyPrefix,
          namespace: parsedInput.namespace,
        }),
      );
    },
  };
};
