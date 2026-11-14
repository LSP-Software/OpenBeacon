import { afterAll, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { testRedisHashSecret } from "../rateLimits/testUtils.ts";
import { OpenBeaconCache } from "./OpenBeaconCache.ts";

const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const user = `test-${crypto.randomUUID()}`;
const password = crypto.randomUUID();
const keyPrefix = `test-${crypto.randomUUID()}`;
const pendingKey = `${keyPrefix}:alertsTurnedOff:pending`;
const url = new URL(redisUrl);
url.username = user;
url.password = password;
let admin: RedisClient | null = null;
let cache: OpenBeaconCache | null = null;
afterAll(async () => {
  cache?.close();
  if (!admin) return;
  await admin.send("ACL", ["DELUSER", user]);
  await admin.send("DEL", [pendingKey]);
  admin.close();
});

test.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")(
  "lists the commands a restricted Redis user can't run, and nothing once it can",
  async () => {
    admin = new RedisClient(redisUrl);
    await admin.send("ZADD", [pendingKey, "1", "user-1"]);
    await admin.send("ACL", [
      "SETUSER",
      user,
      "on",
      `>${password}`,
      `~${keyPrefix}:*`,
      "+ping",
      "+eval",
      "+hmget",
      "+hset",
      "+pexpire",
      "+del",
      "+get",
      "+set",
    ]);
    cache = new OpenBeaconCache({
      redisUrl: url.toString(),
      hashSecret: testRedisHashSecret,
      keyPrefix,
    });

    expect(await cache.findMissingPermissions()).toEqual({
      missing: ["HSETNX", "HGET", "HKEYS", "ZADD", "ZRANGE", "ZREM"],
      keyPattern: `${keyPrefix}:*`,
    });

    await admin.send("ACL", ["SETUSER", user, "+@all"]);
    expect((await cache.findMissingPermissions()).missing).toEqual([]);
    expect(await admin.send("KEYS", [`${keyPrefix}:*`])).toEqual([pendingKey]);
    expect(await admin.send("ZRANGE", [pendingKey, "0", "-1"])).toEqual(["user-1"]);
  },
);
