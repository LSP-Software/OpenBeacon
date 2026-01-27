import type { DatabaseClient } from "@openbeacon/database";
import { cacheClient } from "./client.js";

export type CacheSerializer<T> = (value: T) => string;
export type CacheDeserializer<T> = (value: string) => T;

export type GetOrSetOptions<T> = {
  fetch: (database: DatabaseClient) => Promise<T>;
  ttlSeconds?: number;
  serialize?: CacheSerializer<T>;
  deserialize?: CacheDeserializer<T>;
  dbClient?: DatabaseClient;
};

const defaultSerialize = <T>(value: T): string => JSON.stringify(value);
const defaultDeserialize = <T>(value: string): T => JSON.parse(value) as T;

export const getFromCache = async <T>(
  key: string,
  deserialize: CacheDeserializer<T> = defaultDeserialize,
): Promise<T | null> => {
  const cached = await cacheClient.get(key);
  if (cached === null) {
    return null;
  }
  return deserialize(cached);
};

export const setInCache = async <T>(
  key: string,
  value: T,
  options?: {
    ttlSeconds?: number;
    serialize?: CacheSerializer<T>;
  },
): Promise<void> => {
  const serialize = options?.serialize ?? defaultSerialize;
  await cacheClient.set(key, serialize(value));
  if (options?.ttlSeconds !== undefined) {
    await cacheClient.expire(key, options.ttlSeconds);
  }
};

const getDatabaseClient = async (): Promise<DatabaseClient> => {
  const { db } = await import("@openbeacon/database");
  return db;
};

export const getOrSet = async <T>(key: string, options: GetOrSetOptions<T>): Promise<T> => {
  const deserialize = options.deserialize ?? defaultDeserialize;
  const cached = await getFromCache(key, deserialize);
  if (cached !== null) {
    return cached;
  }

  const database = options.dbClient ?? (await getDatabaseClient());
  const value = await options.fetch(database);
  const cacheOptions: {
    ttlSeconds?: number;
    serialize?: CacheSerializer<T>;
  } = {};
  if (options.ttlSeconds !== undefined) {
    cacheOptions.ttlSeconds = options.ttlSeconds;
  }
  if (options.serialize !== undefined) {
    cacheOptions.serialize = options.serialize;
  }
  await setInCache(key, value, Object.keys(cacheOptions).length > 0 ? cacheOptions : undefined);

  return value;
};
