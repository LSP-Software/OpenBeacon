import type { RedisLike } from "./redis.ts";

export const redisTimeoutCode = "ERR_REDIS_TIMEOUT";

export const createSelfHealingRedis = ({
  client,
  commandTimeoutMs = 2_000,
  maxReconnectDelayMs = 5_000,
  sleep = Bun.sleep,
}: {
  client: {
    readonly connected: boolean;
    onclose: ((error: Error) => void) | null;
    connect: () => Promise<unknown>;
    send: (command: string, args: string[]) => Promise<unknown>;
    del: (...keys: string[]) => Promise<number>;
    close: () => void;
  };
  commandTimeoutMs?: number;
  maxReconnectDelayMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
}): RedisLike => {
  let closed = false;
  let unreachable = false;
  let connecting: Promise<void> | null = null;

  const connect = () => {
    connecting ??= Promise.resolve()
      .then(async () => {
        for (let delayMs = 100; !closed && !client.connected;) {
          unreachable = !(await client.connect().then(
            () => true,
            () => false,
          ));
          if (!unreachable) return;
          await sleep(delayMs);
          delayMs = Math.min(delayMs * 2, maxReconnectDelayMs);
        }
      })
      .finally(() => {
        connecting = null;
      });
    return connecting;
  };
  client.onclose = () => {
    if (!closed) void connect();
  };

  const run = async <T>(command: () => Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            Object.assign(new Error("Redis didn't answer in time"), { code: redisTimeoutCode }),
          ),
        commandTimeoutMs,
      );
    });
    return Promise.race([
      (async () => {
        if (!client.connected && unreachable)
          throw Object.assign(new Error("Redis is unreachable"), {
            code: "ERR_REDIS_CONNECTION_CLOSED",
          });
        if (!client.connected) await connect();
        return command();
      })(),
      timeout,
    ]).finally(() => clearTimeout(timer));
  };

  void connect();

  return {
    send: (command, args) => run(() => client.send(command, args)),
    del: (...keys) => run(() => client.del(...keys)),
    close: () => {
      closed = true;
      client.close();
    },
  };
};
