import { beforeEach, expect, mock, test } from "bun:test";

const stored = new Map<string, string | number>();
const nativeCalls: string[] = [];

mock.module("./storage.ts", () => ({
  storage: {
    getNumber: (key: string) => {
      const value = stored.get(key);
      return typeof value === "number" ? value : undefined;
    },
    getString: (key: string) => {
      const value = stored.get(key);
      return typeof value === "string" ? value : undefined;
    },
    set: (key: string, value: string | number) => {
      stored.set(key, value);
    },
    remove: (key: string) => stored.delete(key),
  },
}));

mock.module("@maplibre/maplibre-react-native", () => ({
  OfflineManager: {
    clearAmbientCache: async () => {
      nativeCalls.push("clear");
    },
    setMaximumAmbientCacheSize: async (size: number) => {
      nativeCalls.push(`size:${size}`);
    },
  },
}));

const {
  applyMapCacheSize,
  clearSavedMap,
  getMapCacheSizeMb,
  readLastMapSource,
  saveLastMapSource,
  setMapCacheSizeMb,
} = await import("./mapCache.ts");

beforeEach(() => {
  stored.clear();
  nativeCalls.length = 0;
});

test("uses 250 MB until a valid size is chosen", async () => {
  expect(getMapCacheSizeMb()).toBe(250);
  stored.set("map.cacheSizeMb", 123);
  expect(getMapCacheSizeMb()).toBe(250);
  await applyMapCacheSize();
  expect(nativeCalls).toEqual([`size:${250 * 1024 * 1024}`]);
});

test("stores a chosen size and applies it in bytes", async () => {
  await setMapCacheSizeMb(1000);
  expect(getMapCacheSizeMb()).toBe(1000);
  expect(nativeCalls).toEqual([`size:${1000 * 1024 * 1024}`]);
});

test("remembers the last map source with or without an archive", () => {
  expect(readLastMapSource()).toBeNull();
  saveLastMapSource({ archiveId: "a-20261101", sourceUrl: "https://t.example/a.pmtiles" });
  expect(readLastMapSource()).toEqual({
    archiveId: "a-20261101",
    sourceUrl: "https://t.example/a.pmtiles",
  });
  saveLastMapSource({ archiveId: null, sourceUrl: "https://t.example/b.pmtiles" });
  expect(readLastMapSource()).toEqual({
    archiveId: null,
    sourceUrl: "https://t.example/b.pmtiles",
  });
});

test("clearing the saved map forgets the source, wipes the tiles and keeps the size", async () => {
  await setMapCacheSizeMb(500);
  saveLastMapSource({ archiveId: "a-20261101", sourceUrl: "https://t.example/a.pmtiles" });
  nativeCalls.length = 0;

  await clearSavedMap();

  expect(readLastMapSource()).toBeNull();
  expect(nativeCalls).toEqual(["clear"]);
  expect(getMapCacheSizeMb()).toBe(500);
});
