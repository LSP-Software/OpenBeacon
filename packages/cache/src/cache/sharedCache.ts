import { redisHashSecretSchema, redisUrlSchema } from "../rateLimits/schemas.ts";
import { OpenBeaconCache } from "./OpenBeaconCache.ts";

let cache: OpenBeaconCache | null = null;

export const sharedCache = () => {
  const hashSecret = process.env["REDIS_HASH_SECRET"];
  cache ??= new OpenBeaconCache({
    redisUrl: redisUrlSchema.parse(process.env["REDIS_URL"]),
    ...(hashSecret ? { hashSecret: redisHashSecretSchema.parse(hashSecret) } : {}),
  });
  return cache;
};
