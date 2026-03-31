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

  const normalizedRedisOptions: Record<string, unknown> = {};

  Object.entries(redisOptions).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedRedisOptions[key] = value;
    }
  });

  return normalizedRedisOptions as RedisOptions;
};
