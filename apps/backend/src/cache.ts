import { OpenBeaconCache } from "@openbeacon/cache";
import { env } from "./env.ts";

export const cache = new OpenBeaconCache({
  redisUrl: env.REDIS_URL,
});
