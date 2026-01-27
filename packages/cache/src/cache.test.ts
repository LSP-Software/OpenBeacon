import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import type { DatabaseClient } from "@openbeacon/database";
import { getOrSet } from "./cache.ts";
import { cacheClient } from "./client.ts";

const createStore = () => new Map<string, string>();

const original = {
  get: cacheClient.get.bind(cacheClient),
  set: cacheClient.set.bind(cacheClient),
  expire: cacheClient.expire.bind(cacheClient),
};

beforeEach(() => {
  const store = createStore();
  cacheClient.get = jest.fn(
    async (key: string) => store.get(key) ?? null,
  ) as typeof cacheClient.get;
  cacheClient.set = jest.fn(async (key: string, value: string) => {
    store.set(key, value);
  }) as typeof cacheClient.set;
  cacheClient.expire = jest.fn(async () => {}) as typeof cacheClient.expire;
});

afterEach(() => {
  cacheClient.get = original.get;
  cacheClient.set = original.set;
  cacheClient.expire = original.expire;
});

test("getOrSet returns cached value without calling fetch", async () => {
  const store = new Map<string, string>([["user:1", JSON.stringify({ id: "1" })]]);
  cacheClient.get = jest.fn(
    async (key: string) => store.get(key) ?? null,
  ) as typeof cacheClient.get;

  const fetch = jest.fn(async () => ({ id: "2" }));
  const result = await getOrSet("user:1", {
    fetch,
    dbClient: {} as DatabaseClient,
  });

  expect(result).toEqual({ id: "1" });
  expect(fetch).not.toHaveBeenCalled();
});

test("getOrSet caches and reuses null values", async () => {
  const store = createStore();
  cacheClient.get = jest.fn(
    async (key: string) => store.get(key) ?? null,
  ) as typeof cacheClient.get;
  cacheClient.set = jest.fn(async (key: string, value: string) => {
    store.set(key, value);
  }) as typeof cacheClient.set;

  const fetch = jest.fn(async () => null);
  const result = await getOrSet("user:missing", {
    fetch,
    dbClient: {} as DatabaseClient,
    ttlSeconds: 60,
  });

  expect(result).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);

  const secondFetch = jest.fn(async () => ({ id: "ignored" }));
  const second = await getOrSet("user:missing", {
    fetch: secondFetch,
    dbClient: {} as DatabaseClient,
  });

  expect(second).toBeNull();
  expect(secondFetch).not.toHaveBeenCalled();
});
