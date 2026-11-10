import { afterAll } from "bun:test";
import { RedisClient, type RedisOptions } from "bun";
import { z } from "zod";
import { OpenBeaconCache } from "./cache/OpenBeaconCache.ts";
import type { RedisLike } from "./cache/redis.ts";

const scanReplySchema = z.tuple([z.string(), z.array(z.string())]);

class IntegrationTestCache extends OpenBeaconCache {
  private used = false;

  protected override createRedisClient(redisUrl: string, redisOptions?: RedisOptions): RedisLike {
    const client = new RedisClient(redisUrl, redisOptions);
    const explainConnectionError = (error: unknown): never => {
      if (
        error instanceof Error &&
        "code" in error &&
        String(error.code).startsWith("ERR_REDIS_CONNECTION")
      ) {
        throw new Error(`Lost or couldn't open the Redis connection at REDIS_URL (${redisUrl})`, {
          cause: error,
        });
      }
      throw error;
    };
    const run = async <T>(command: Promise<T>) => {
      const reply = await command.catch(explainConnectionError);
      this.used = true;
      return reply;
    };
    return {
      send: (command, args) => run(client.send(command, args)),
      del: (...keys) => run(client.del(...keys)),
      close: () => client.close(),
    };
  }

  public override async close(): Promise<void> {
    try {
      let cursor = this.used ? "0" : null;
      while (cursor !== null) {
        const [nextCursor, keys] = scanReplySchema.parse(
          await this.redis.send("SCAN", [cursor, "MATCH", `${this.keyPrefix}:*`, "COUNT", "1000"]),
        );
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
        cursor = nextCursor === "0" ? null : nextCursor;
      }
    } finally {
      super.close();
    }
  }
}

export const createIntegrationTestCache = (now: () => number) => {
  const cache = new IntegrationTestCache({
    redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
    keyPrefix: `test-${crypto.randomUUID()}`,
    redisOptions: { connectionTimeout: 1000, autoReconnect: false },
    now,
  });
  afterAll(() => cache.close());
  return cache;
};
