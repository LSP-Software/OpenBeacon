import { beforeEach, expect, mock, test } from "bun:test";

const stored = new Map<string, string | boolean>();
const nativeCalls: string[] = [];
const failing = new Set<"clear">();

mock.module("./storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => {
      const value = stored.get(key);
      return typeof value === "boolean" ? value : undefined;
    },
    getString: (key: string) => {
      const value = stored.get(key);
      return typeof value === "string" ? value : undefined;
    },
    set: (key: string, value: string | boolean) => {
      stored.set(key, value);
    },
    remove: (key: string) => stored.delete(key),
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
    },
  },
}));

const { clearSavedMap, prepareMapCache, readLastMapSource, saveLastMapSource } =
  await import("./mapCache.ts");

beforeEach(() => {
  stored.clear();
  nativeCalls.length = 0;
  failing.clear();
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

test("clearing the saved map forgets the source and wipes the tiles", async () => {
  saveLastMapSource({ archiveId: "a-20261101", sourceUrl: "https://t.example/a.pmtiles" });
  nativeCalls.length = 0;

  await clearSavedMap();

  expect(readLastMapSource()).toBeNull();
  expect(nativeCalls).toEqual(["clear"]);
  expect(stored.has("map.clearPending")).toBe(false);
});

test("a failed clear stays pending until the map is prepared again", async () => {
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

  expect(nativeCalls).toEqual(["clear", "size:250000000"]);
  expect(stored.has("map.clearPending")).toBe(false);
});

test("preparing the map caps the cache at 250 MB and forgets the old size setting", async () => {
  stored.set("map.cacheSizeMb", "1000");
  await prepareMapCache();
  expect(nativeCalls).toEqual(["size:250000000"]);
  expect(stored.has("map.cacheSizeMb")).toBe(false);
});
