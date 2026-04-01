import type { RedisOptions } from "bun";

type RedisOptionsInput = {
  connectionTimeout?: number | undefined;
  idleTimeout?: number | undefined;
  autoReconnect?: boolean | undefined;
  maxRetries?: number | undefined;
  enableOfflineQueue?: boolean | undefined;
  tls?: RedisOptions["tls"] | undefined;
  enableAutoPipelining?: boolean | undefined;
};

export type RedisLike = {
  send: (command: string, args: string[]) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
  close: () => void;
};

export const toRedisOptions = (
  redisOptions: RedisOptionsInput | undefined,
): RedisOptions | undefined => {
  if (!redisOptions) {
    return undefined;
  }

  const normalizedRedisOptions = {
    ...(redisOptions.connectionTimeout !== undefined
      ? { connectionTimeout: redisOptions.connectionTimeout }
      : {}),
    ...(redisOptions.idleTimeout !== undefined ? { idleTimeout: redisOptions.idleTimeout } : {}),
    ...(redisOptions.autoReconnect !== undefined
      ? { autoReconnect: redisOptions.autoReconnect }
      : {}),
    ...(redisOptions.maxRetries !== undefined ? { maxRetries: redisOptions.maxRetries } : {}),
    ...(redisOptions.enableOfflineQueue !== undefined
      ? { enableOfflineQueue: redisOptions.enableOfflineQueue }
      : {}),
    ...(redisOptions.tls !== undefined ? { tls: redisOptions.tls } : {}),
    ...(redisOptions.enableAutoPipelining !== undefined
      ? { enableAutoPipelining: redisOptions.enableAutoPipelining }
      : {}),
  } satisfies Partial<RedisOptions>;

  return normalizedRedisOptions;
};
