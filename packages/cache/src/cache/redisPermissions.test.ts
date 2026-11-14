import { expect, test } from "bun:test";
import { alertsTurnedOffScripts } from "../alertsTurnedOff/alertsTurnedOff.ts";
import { rateLimitScript } from "../rateLimits/rateLimits.ts";
import type { RedisLike } from "./redis.ts";
import { findMissingRedisPermissions } from "./redisPermissions.ts";

const denied = () => Promise.reject(new Error("NOPERM openbeacon has no ACL permissions"));
const redisAllowing = (allowed: (command: string, args: string[]) => boolean) => {
  const sent: string[][] = [];
  const redis: RedisLike = {
    send: async (command, args) => {
      sent.push([command, ...args]);
      return allowed(command, args) ? "OK" : denied();
    },
    del: async (...keys) => (allowed("DEL", keys) ? keys.length : denied()),
    close: () => {},
  };
  return { redis, sent };
};

test("checks every command the cache sends or its scripts call", async () => {
  const { redis } = redisAllowing((command, args) => command === "EVAL" && args[0] === "return 1");
  const { missing } = await findMissingRedisPermissions({ keyPrefix: "openbeacon", redis });
  const scriptCommands = [rateLimitScript, ...Object.values(alertsTurnedOffScripts)].flatMap(
    (script) => [...script.matchAll(/redis\.call\("(\w+)"/g)].map((match) => match[1]),
  );
  const sources = await Promise.all(
    [...new Bun.Glob("src/**/*.ts").scanSync(`${import.meta.dir}/../..`)]
      .filter((path) => !/test|redisPermissions/i.test(path))
      .map((path) => Bun.file(`${import.meta.dir}/../../${path}`).text()),
  );
  const sentCommands = sources.flatMap((source) =>
    [...source.matchAll(/redis\.send\("(\w+)"/g)].map((match) => match[1]),
  );
  expect(scriptCommands).toContain("ZADD");
  expect(sentCommands).toContain("GET");
  expect([...missing, "EVAL"]).toEqual(
    expect.arrayContaining(["DEL", ...scriptCommands, ...sentCommands]),
  );
  expect(missing).not.toContain("EVAL");
});

test("reports EVAL without checking script commands when scripts are blocked", async () => {
  const { redis, sent } = redisAllowing((command) => command !== "EVAL");
  expect(await findMissingRedisPermissions({ keyPrefix: "openbeacon", redis })).toEqual({
    missing: ["EVAL"],
    keyPattern: "openbeacon:*",
  });
  expect(sent.filter(([command]) => command === "EVAL")).toHaveLength(1);
});

test("Redis's own wording for a command blocked inside a script counts as missing", async () => {
  const { redis } = redisAllowing(() => true);
  const send = redis.send;
  redis.send = (command, args) =>
    args[0]?.includes('"ZADD"')
      ? Promise.reject(
          new Error(
            "ERR ACL failure in script: User t has no permissions to run the 'zadd' command",
          ),
        )
      : send(command, args);
  expect((await findMissingRedisPermissions({ keyPrefix: "openbeacon", redis })).missing).toEqual([
    "ZADD",
  ]);
});

test("a connection failure is not reported as a missing permission", async () => {
  const { redis } = redisAllowing(() => true);
  redis.send = () => Promise.reject(new Error("Redis is unreachable"));
  await expect(findMissingRedisPermissions({ keyPrefix: "openbeacon", redis })).rejects.toThrow(
    "Redis is unreachable",
  );
});
