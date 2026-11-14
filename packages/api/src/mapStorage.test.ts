import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import type { MapTilesManifest } from "@openbeacon/map-tiles";

const mapTiles = await import("@openbeacon/map-tiles");
const checkMapArchive = mock(async (_input: unknown) => {});
mock.module("@openbeacon/map-tiles", () => ({
  ...mapTiles,
  checkMapArchive,
  readManifest: async () => null,
}));

const {
  checkMapStorage,
  createManifestCache,
  MAP_TILES_MANIFEST_CACHE_MS,
  mapEnv,
  mapStorageClient,
  resolvePmtilesArchive,
} = await import("./mapStorage.ts");

const manifest = (key: string): MapTilesManifest => ({
  current: "a",
  slots: {
    a: {
      build: "20261101",
      key,
      publishedAt: "2026-11-01T00:00:00.000Z",
      schemaVersion: "4.15.2",
      size: 1,
    },
    b: null,
  },
});

describe("createManifestCache", () => {
  test("reuses the manifest until the cache expires", async () => {
    let time = 0;
    const read = mock(async () => manifest(`planet-${time}.pmtiles`));
    const getManifest = createManifestCache({ now: () => time, read });

    expect((await getManifest())?.slots.a?.key).toBe("planet-0.pmtiles");
    time = MAP_TILES_MANIFEST_CACHE_MS - 1;
    expect((await getManifest())?.slots.a?.key).toBe("planet-0.pmtiles");
    time = MAP_TILES_MANIFEST_CACHE_MS;
    expect((await getManifest())?.slots.a?.key).toBe(
      `planet-${MAP_TILES_MANIFEST_CACHE_MS}.pmtiles`,
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("shares one read between concurrent requests", async () => {
    let resolveRead: (manifest: MapTilesManifest) => void = () => {};
    const read = mock(
      () =>
        new Promise<MapTilesManifest>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const getManifest = createManifestCache({ now: () => 0, read });

    const requests = [getManifest(), getManifest(), getManifest()];
    resolveRead(manifest("planet-a.pmtiles"));

    expect((await Promise.all(requests)).map((result) => result?.slots.a?.key)).toEqual([
      "planet-a.pmtiles",
      "planet-a.pmtiles",
      "planet-a.pmtiles",
    ]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("caches a missing manifest", async () => {
    const read = mock(async () => null);
    const getManifest = createManifestCache({ now: () => 0, read });

    expect(await getManifest()).toBeNull();
    expect(await getManifest()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("keeps serving the last manifest when a refresh fails", async () => {
    let time = 0;
    const read = mock(async () => manifest("planet-a.pmtiles"));
    const getManifest = createManifestCache({ now: () => time, read });

    await getManifest();
    read.mockRejectedValueOnce(new Error("map storage unavailable"));
    time = MAP_TILES_MANIFEST_CACHE_MS;

    expect((await getManifest())?.slots.a?.key).toBe("planet-a.pmtiles");
  });

  test("fails when the first read fails", async () => {
    const getManifest = createManifestCache({
      now: () => 0,
      read: async () => {
        throw new Error("map storage unavailable");
      },
    });

    await expect(getManifest()).rejects.toThrow("map storage unavailable");
  });
});

describe("resolvePmtilesArchive", () => {
  afterAll(() => mock.restore());

  test("reports that the map isn't ready while map storage has no manifest", async () => {
    await expect(resolvePmtilesArchive(undefined)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("checkMapStorage", () => {
  test("checks the map archive in the configured map bucket", async () => {
    await checkMapStorage();
    expect(checkMapArchive).toHaveBeenLastCalledWith({
      bucket: mapEnv.MAP_S3_BUCKET_NAME,
      client: mapStorageClient,
    });
  });

  test("explains likely fixes under the storage label", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const noSuchBucket = Object.assign(new Error("The bucket does not exist"), {
      name: "NoSuchBucket",
    });
    checkMapArchive.mockRejectedValueOnce(noSuchBucket);

    await expect(checkMapStorage()).rejects.toBe(noSuchBucket);
    expect(consoleError.mock.calls).toEqual([["  Map storage: check MAP_S3_BUCKET_NAME"]]);
    consoleError.mockRestore();
  });
});
