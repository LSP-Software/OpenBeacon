import { RedisClient } from "bun";
import type { RedisLike } from "./redis.ts";

export const findMissingRedisPermissions = async ({
  keyPrefix,
  redis,
}: {
  keyPrefix: string;
  redis: RedisLike;
}) => {
  const id = "permissionCheck";
  const stringKey = `${keyPrefix}:pmtilesSignedUrl:user:${id}:archive:${id}`;
  const rateLimitKey = `${keyPrefix}:ratelimit:${id}:server`;
  const alertsKey = `${keyPrefix}:alertsTurnedOff:user:${id}`;
  const alertsIndexKey = `${keyPrefix}:alertsTurnedOff:pending`;
  const inScript = (command: string, key: string, args: string) => ({
    command,
    run: () => redis.send("EVAL", [`redis.call("${command}", KEYS[1]${args}) return 1`, "1", key]),
  });
  const directChecks = [
    { command: "PING", run: () => redis.send("PING", []) },
    { command: "SET", run: () => redis.send("SET", [stringKey, "1", "PX", "60000"]) },
    { command: "GET", run: () => redis.send("GET", [stringKey]) },
    { command: "DEL", run: () => redis.del(stringKey) },
  ];
  const scriptChecks = [
    inScript("HMGET", rateLimitKey, `, "tokens", "lastMs"`),
    inScript("HSET", rateLimitKey, `, "tokens", "1", "lastMs", "1"`),
    inScript("PEXPIRE", rateLimitKey, ", 60000"),
    inScript("HSETNX", alertsKey, `, "firstAt", "1"`),
    inScript("HSET", alertsKey, `, "new-sign-in", "1"`),
    inScript("PEXPIRE", alertsKey, ", 60000"),
    inScript("HGET", alertsKey, `, "firstAt"`),
    inScript("HKEYS", alertsKey, ""),
    inScript("DEL", alertsKey, ""),
    inScript("ZADD", alertsIndexKey, `, 0, "${id}"`),
    inScript("ZRANGE", alertsIndexKey, `, 0, -1, "WITHSCORES"`),
    inScript("ZREM", alertsIndexKey, `, "${id}"`),
  ];
  const missing = new Set<string>();
  const check = async ({ command, run }: { command: string; run: () => Promise<unknown> }) => {
    const denied = await run().then(
      () => false,
      (error: unknown) => {
        if (error instanceof Error && /NOPERM|ACL failure/.test(error.message)) return true;
        throw error;
      },
    );
    if (denied) missing.add(command);
    return !denied;
  };
  try {
    for (const directCheck of directChecks) await check(directCheck);
    const canEval = await check({
      command: "EVAL",
      run: () => redis.send("EVAL", ["return 1", "0"]),
    });
    if (canEval) for (const scriptCheck of scriptChecks) await check(scriptCheck);
  } finally {
    await redis.del(stringKey, rateLimitKey, alertsKey).catch(() => 0);
  }
  return { missing: [...missing], keyPattern: `${keyPrefix}:*` };
};

export const pingRedis = async (redisUrl: string) => {
  const redis = new RedisClient(redisUrl);
  try {
    await redis.send("PING", []);
  } finally {
    redis.close();
  }
};
