import { RedisClient, type RedisOptions } from "bun";
import { createAlertsTurnedOff } from "../alertsTurnedOff/alertsTurnedOff.ts";
import { createPmtilesSignedUrls } from "../pmtilesSignedUrls/pmtilesSignedUrls.ts";
import type {
  PmtilesSignedUrlInput,
  PmtilesSignedUrlValue,
  SetPmtilesSignedUrlInput,
} from "../pmtilesSignedUrls/schemas.ts";
import { createRateLimits } from "../rateLimits/rateLimits.ts";
import type {
  OpenBeaconCacheOptions,
  RateLimitConsumeInput,
  RateLimitPeekInput,
  RateLimitResetInput,
} from "../rateLimits/schemas.ts";
import { openBeaconCacheOptionsSchema } from "../rateLimits/schemas.ts";
import type { RateLimitResult, WhenRedisUnavailable } from "../rateLimits/types.ts";
import { type RedisLike, toRedisOptions } from "./redis.ts";
import { createSelfHealingRedis } from "./selfHealingRedis.ts";

export class OpenBeaconCache {
  public readonly alertsTurnedOff: ReturnType<typeof createAlertsTurnedOff>;
  public readonly pmtilesSignedUrls: {
    get: (input: PmtilesSignedUrlInput) => Promise<PmtilesSignedUrlValue | null>;
    set: (input: SetPmtilesSignedUrlInput) => Promise<void>;
    reset: (input: PmtilesSignedUrlInput) => Promise<number>;
  };
  public readonly rateLimits: {
    peek: (input: RateLimitPeekInput, options?: WhenRedisUnavailable) => Promise<RateLimitResult>;
    consume: (
      input: RateLimitConsumeInput,
      options?: WhenRedisUnavailable,
    ) => Promise<RateLimitResult>;
    refund: (input: RateLimitConsumeInput) => Promise<RateLimitResult>;
    reset: (input: RateLimitResetInput) => Promise<number>;
  };
  protected readonly now: () => number;
  protected readonly redis: RedisLike;
  protected readonly keyPrefix: string;

  public constructor(options: OpenBeaconCacheOptions) {
    const parsedOptions = openBeaconCacheOptionsSchema.parse(options);

    this.now = parsedOptions.now ?? Date.now;
    this.keyPrefix = parsedOptions.keyPrefix ?? "openbeacon";
    this.redis = this.createRedisClient(
      parsedOptions.redisUrl,
      toRedisOptions(parsedOptions.redisOptions),
    );
    this.alertsTurnedOff = createAlertsTurnedOff({ redis: this.redis, keyPrefix: this.keyPrefix });
    this.pmtilesSignedUrls = createPmtilesSignedUrls({
      redis: this.redis,
      now: this.now,
      keyPrefix: this.keyPrefix,
    });
    this.rateLimits = createRateLimits({
      hashSecret: parsedOptions.hashSecret,
      redis: this.redis,
      now: this.now,
      keyPrefix: this.keyPrefix,
    });
  }

  protected createRedisClient(redisUrl: string, redisOptions?: RedisOptions): RedisLike {
    return createSelfHealingRedis({
      client: new RedisClient(redisUrl, {
        connectionTimeout: 2_000,
        ...redisOptions,
        autoReconnect: false,
        enableOfflineQueue: false,
      }),
    });
  }

  public async ping(): Promise<boolean> {
    return this.redis.send("PING", []).then(
      (reply) => reply === "PONG",
      () => false,
    );
  }

  public close(): void {
    this.redis.close();
  }
}
