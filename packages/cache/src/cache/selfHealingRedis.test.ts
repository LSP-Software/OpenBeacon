import { expect, test } from "bun:test";
import { createSelfHealingRedis, redisTimeoutCode } from "./selfHealingRedis.ts";

const createFakeClient = () => {
  const client = {
    connected: false,
    up: true,
    hang: false,
    connectAttempts: 0,
    onclose: null as ((error: Error) => void) | null,
    connect: async () => {
      client.connectAttempts += 1;
      if (!client.up) {
        client.onclose?.(new Error("closed"));
        throw Object.assign(new Error("closed"), { code: "ERR_REDIS_CONNECTION_CLOSED" });
      }
      client.connected = true;
    },
    send: async (command: string) => {
      if (!client.connected)
        throw Object.assign(new Error("closed"), { code: "ERR_REDIS_CONNECTION_CLOSED" });
      if (client.hang) return new Promise<never>(() => {});
      return command === "PING" ? "PONG" : "OK";
    },
    del: async () => 1,
    close: () => {
      client.connected = false;
    },
    drop: () => {
      client.connected = false;
      client.up = false;
      client.onclose?.(new Error("closed"));
    },
  };
  return client;
};

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error as { code?: string }).code,
  );

test("connects before the first command instead of failing it", async () => {
  const client = createFakeClient();
  const redis = createSelfHealingRedis({ client, sleep: async () => {} });
  expect(await redis.send("PING", [])).toBe("PONG");
  redis.close();
});

test("fails fast while Redis is down and reconnects with backoff once it is back", async () => {
  const client = createFakeClient();
  const delays: number[] = [];
  let resume = () => {};
  const redis = createSelfHealingRedis({
    client,
    maxReconnectDelayMs: 400,
    sleep: (ms) => {
      delays.push(ms);
      if (delays.length < 5) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resume = resolve;
      });
    },
  });
  await redis.send("PING", []);
  client.drop();
  await Bun.sleep(0);
  const started = performance.now();
  expect(await codeOf(redis.send("GET", ["key"]))).toBe("ERR_REDIS_CONNECTION_CLOSED");
  expect(performance.now() - started).toBeLessThan(100);
  expect(delays).toEqual([100, 200, 400, 400, 400]);

  client.up = true;
  resume();
  await Bun.sleep(0);
  expect(client.connected).toBe(true);
  expect(await redis.send("GET", ["key"])).toBe("OK");
  redis.close();
});

test("a command that gets no answer fails after the timeout", async () => {
  const client = createFakeClient();
  const redis = createSelfHealingRedis({ client, commandTimeoutMs: 20, sleep: async () => {} });
  await redis.send("PING", []);
  client.hang = true;
  expect(await codeOf(redis.send("GET", ["key"]))).toBe(redisTimeoutCode);
  redis.close();
});

test("a deliberate close stops reconnecting", async () => {
  const client = createFakeClient();
  const redis = createSelfHealingRedis({ client, sleep: async () => {} });
  await redis.send("PING", []);
  const attempts = client.connectAttempts;
  redis.close();
  client.onclose?.(new Error("closed"));
  await Bun.sleep(0);
  expect(client.connectAttempts).toBe(attempts);
});
