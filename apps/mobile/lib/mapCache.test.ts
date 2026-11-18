import { beforeEach, expect, mock, test } from "bun:test";

const stored = new Map<string, string | number | boolean>();
const nativeCalls: string[] = [];
const failing = new Set<"clear" | "size">();

mock.module("./storage.ts", () => ({
  storage: {
    getNumber: (key: string) => {
      const value = stored.get(key);
      return typeof value === "number" ? value : undefined;
    },
    getBoolean: (key: string) => {
      const value = stored.get(key);
      return typeof value === "boolean" ? value : undefined;
    },
    getString: (key: string) => {
      const value = stored.get(key);
      return typeof value === "string" ? value : undefined;
    },
    set: (key: string, value: string | number | boolean) => {
      stored.set(key, value);
    },
    remove: (key: string) => stored.delete(key),
    getAllKeys: () => [...stored.keys()],
  },
}));

mock.module("@maplibre/maplibre-react-native", () => ({
  OfflineManager: {
    clearAmbientCache: async () => {
      nativeCalls.push("clear");
      if (failing.has("clear")) throw new Error("clear failed");
    },
    setMaximumAmbientCacheSize: async (size: number) => {
      nativeCalls.push(`size:${size}`);
      if (failing.has("size")) throw new Error("size failed");
    },
  },
}));

const {
  applyMapCacheSize,
  clearSavedMap,
  getMapCacheSizeMb,
  prepareMapCache,
  readLastMapSource,
  saveLastMapSource,
  setMapCacheSizeMb,
} = await import("./mapCache.ts");

beforeEach(() => {
  stored.clear();
  nativeCalls.length = 0;
  failing.clear();
});

test("uses 250 MB until a valid size is chosen", async () => {
  expect(getMapCacheSizeMb()).toBe(250);
  stored.set("map.cacheSizeMb", 123);
  expect(getMapCacheSizeMb()).toBe(250);
  await applyMapCacheSize();
  expect(nativeCalls).toEqual(["size:250000000"]);
});

test("stores a chosen size and applies it in SI bytes", async () => {
  await setMapCacheSizeMb(1000);
  expect(getMapCacheSizeMb()).toBe(1000);
  expect(nativeCalls).toEqual(["size:1000000000"]);
});

test("keeps the old size when applying a new one fails", async () => {
  await setMapCacheSizeMb(500);
  failing.add("size");

  await expect(setMapCacheSizeMb(100)).rejects.toThrow("size failed");

  expect(getMapCacheSizeMb()).toBe(500);
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
  stored.set("memberArea.archiveId", "a-20261101");
  stored.set("memberArea.11/1023/681", "[]");
  nativeCalls.length = 0;

  await clearSavedMap();

  expect(readLastMapSource()).toBeNull();
  expect([...stored.keys()].filter((key) => key.startsWith("memberArea."))).toEqual([]);
  expect(nativeCalls).toEqual(["clear"]);
  expect(stored.has("map.clearPending")).toBe(false);
  expect(getMapCacheSizeMb()).toBe(500);
});

test("a failed clear stays pending until the map is prepared again", async () => {
  await setMapCacheSizeMb(100);
  saveLastMapSource({ archiveId: "a-20261101", sourceUrl: "https://t.example/a.pmtiles" });
  failing.add("clear");

  await expect(clearSavedMap()).rejects.toThrow("clear failed");
  expect(stored.get("map.clearPending")).toBe(true);
  expect(readLastMapSource()).toBeNull();

  await expect(prepareMapCache()).rejects.toThrow("clear failed");
  expect(stored.get("map.clearPending")).toBe(true);

  failing.clear();
  nativeCalls.length = 0;
  await prepareMapCache();

  expect(nativeCalls).toEqual(["clear", "size:100000000"]);
  expect(stored.has("map.clearPending")).toBe(false);
});

test("preparing the map without a pending clear only applies the size", async () => {
  await prepareMapCache();
  expect(nativeCalls).toEqual(["size:250000000"]);
});
