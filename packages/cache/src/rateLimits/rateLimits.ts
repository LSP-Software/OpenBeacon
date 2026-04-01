import type { RedisLike } from "../cache/redis.ts";
import {
  rateLimitConsumeInputSchema,
  rateLimitPeekInputSchema,
  rateLimitResetInputSchema,
} from "./schemas.ts";
import type { RateLimitResult } from "./types.ts";

type RateLimitsDependencies = {
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
    tokens = tokens - cost
  end
end

local missing_tokens = math.max(0, cost - tokens)
local retry_after_ms = 0
if missing_tokens > 0 then
  retry_after_ms = math.ceil(missing_tokens / refill_rate)
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
  keyPrefix,
  namespace,
}: {
  identifier: {
    type: "ip" | "userId";
    value: string;
  };
  keyPrefix: string;
  namespace: string;
}) => {
  return `${keyPrefix}:ratelimit:${namespace}:${identifier.type}:${identifier.value}`;
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
  keyPrefix,
  limit,
  namespace,
  now,
  redis,
  shouldConsume,
  windowMs,
  cost,
}: {
  identifier: {
    type: "ip" | "userId";
    value: string;
  };
  keyPrefix: string;
  limit: number;
  namespace: string;
  now: () => number;
  redis: RedisLike;
  shouldConsume: boolean;
  windowMs: number;
  cost: number;
}) => {
  const key = buildRateLimitKey({ identifier, keyPrefix, namespace });

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

export const createRateLimits = ({ keyPrefix, now, redis }: RateLimitsDependencies) => {
  return {
    peek: async (input: Parameters<typeof rateLimitPeekInputSchema.parse>[0]) => {
      const parsedInput = rateLimitPeekInputSchema.parse(input);

      return executeRateLimitScript({
        redis,
        keyPrefix,
        now,
        ...parsedInput,
        shouldConsume: false,
        cost: 0,
      });
    },
    consume: async (input: Parameters<typeof rateLimitConsumeInputSchema.parse>[0]) => {
      const parsedInput = rateLimitConsumeInputSchema.parse(input);

      return executeRateLimitScript({
        redis,
        keyPrefix,
        now,
        ...parsedInput,
        shouldConsume: true,
        cost: parsedInput.cost ?? 1,
      });
    },
    reset: async (input: Parameters<typeof rateLimitResetInputSchema.parse>[0]) => {
      const parsedInput = rateLimitResetInputSchema.parse(input);

      return redis.del(
        buildRateLimitKey({
          identifier: parsedInput.identifier,
          keyPrefix,
          namespace: parsedInput.namespace,
        }),
      );
    },
  };
};
