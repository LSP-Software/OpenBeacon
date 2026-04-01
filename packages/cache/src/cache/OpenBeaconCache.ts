import { RedisClient, type RedisOptions } from "bun";
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
import type { RateLimitResult } from "../rateLimits/types.ts";
import { type RedisLike, toRedisOptions } from "./redis.ts";

export class OpenBeaconCache {
  public readonly pmtilesSignedUrls: {
    get: (input: PmtilesSignedUrlInput) => Promise<PmtilesSignedUrlValue | null>;
    set: (input: SetPmtilesSignedUrlInput) => Promise<void>;
    reset: (input: PmtilesSignedUrlInput) => Promise<number>;
  };
  public readonly rateLimits: {
    peek: (input: RateLimitPeekInput) => Promise<RateLimitResult>;
    consume: (input: RateLimitConsumeInput) => Promise<RateLimitResult>;
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
    this.pmtilesSignedUrls = createPmtilesSignedUrls({
      redis: this.redis,
      now: this.now,
      keyPrefix: this.keyPrefix,
    });
    this.rateLimits = createRateLimits({
      redis: this.redis,
      now: this.now,
      keyPrefix: this.keyPrefix,
    });
  }

  protected createRedisClient(redisUrl: string, redisOptions?: RedisOptions): RedisLike {
    return new RedisClient(redisUrl, redisOptions);
  }

  public close(): void {
    this.redis.close();
  }
}
