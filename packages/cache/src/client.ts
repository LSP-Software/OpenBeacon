import { RedisClient } from "bun";
import { env } from "./env.ts";

export const cacheClient = new RedisClient(env.REDIS_URL);

export type CacheClient = typeof cacheClient;
