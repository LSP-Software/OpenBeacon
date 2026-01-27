import { SetMetadata } from "@nestjs/common";

export type RateLimitOptions = {
  limit: number;
  windowSeconds: number;
  keyPrefix?: string;
};

export const RATE_LIMIT_METADATA_KEY = Symbol("rateLimit");

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_METADATA_KEY, options);
