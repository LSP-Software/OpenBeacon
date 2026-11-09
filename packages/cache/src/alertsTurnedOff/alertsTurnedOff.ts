import type { RedisLike } from "../cache/redis.ts";

export const alertsTurnedOffScripts = {
  add: `
if redis.call("HSETNX", KEYS[1], "firstAt", ARGV[2]) == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[3])
end
for i = 4, #ARGV do
  redis.call("HSET", KEYS[1], ARGV[i], "1")
end
local first_at = redis.call("HGET", KEYS[1], "firstAt")
redis.call("ZADD", KEYS[2], first_at, ARGV[1])
return first_at
`,
  take: `
local first_at = redis.call("HGET", KEYS[1], "firstAt")
if first_at and tonumber(first_at) > tonumber(ARGV[2]) then
  return false
end
local fields = redis.call("HKEYS", KEYS[1])
redis.call("DEL", KEYS[1])
redis.call("ZREM", KEYS[2], ARGV[1])
if not first_at then
  return false
end
local result = { first_at }
for _, field in ipairs(fields) do
  if field ~= "firstAt" then
    table.insert(result, field)
  end
end
return result
`,
  pending: `return redis.call("ZRANGE", KEYS[1], 0, -1, "WITHSCORES")`,
};

export const createAlertsTurnedOff = ({
  keyPrefix,
  redis,
}: {
  keyPrefix: string;
  redis: RedisLike;
}) => {
  const indexKey = `${keyPrefix}:alertsTurnedOff:pending`;
  const userKey = (userId: string) => `${keyPrefix}:alertsTurnedOff:user:${userId}`;
  return {
    add: async ({ userId, alerts, at }: { userId: string; alerts: string[]; at: number }) =>
      Number(
        await redis.send("EVAL", [
          alertsTurnedOffScripts.add,
          "2",
          userKey(userId),
          indexKey,
          userId,
          String(at),
          String(24 * 60 * 60 * 1000),
          ...alerts,
        ]),
      ),
    take: async ({
      userId,
      firstAtOrBefore,
    }: {
      userId: string;
      firstAtOrBefore: number;
    }): Promise<{ firstAt: number; alerts: string[] } | null> => {
      const result = await redis.send("EVAL", [
        alertsTurnedOffScripts.take,
        "2",
        userKey(userId),
        indexKey,
        userId,
        String(firstAtOrBefore),
      ]);
      if (!Array.isArray(result) || !result.length) return null;
      const [firstAt, ...alerts] = result.map(String);
      return { firstAt: Number(firstAt), alerts };
    },
    pending: async () => {
      const result = await redis.send("EVAL", [alertsTurnedOffScripts.pending, "1", indexKey]);
      if (!Array.isArray(result)) return [];
      return result.flatMap((userId, index) =>
        index % 2 === 0 ? [{ userId: String(userId), firstAt: Number(result[index + 1]) }] : [],
      );
    },
  };
};
