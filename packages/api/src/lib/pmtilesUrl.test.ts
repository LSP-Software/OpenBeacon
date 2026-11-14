import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { OpenBeaconCache } from "@openbeacon/cache";

const withEnvSnapshot = (keys: readonly string[]) => {
  const saved = new Map<string, string | undefined>();

  return {
    restore: () => {
      for (const key of keys) {
        if (!saved.has(key)) {
          continue;
        }
        const value = saved.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
    save: () => {
      saved.clear();
      for (const key of keys) {
        saved.set(key, process.env[key]);
      }
    },
  };
};

const pmtilesUrlTestEnvKeys = [
  "IMAGES_S3_ENDPOINT",
  "IMAGES_S3_REGION",
  "IMAGES_S3_CDN_URL",
  "MAP_S3_REGION",
  "IMAGES_S3_ACCESS_KEY_ID",
  "IMAGES_S3_ACCESS_KEY",
  "IMAGES_S3_BUCKET_NAME",
  "MAP_S3_ENDPOINT",
  "MAP_S3_ACCESS_KEY_ID",
  "MAP_S3_ACCESS_KEY",
  "MAP_S3_BUCKET_NAME",
] as const;

const createCache = ({
  cachedSignedPmtilesUrls = {},
}: {
  cachedSignedPmtilesUrls?: Record<string, { expiresAt: string; url: string }>;
} = {}) => {
  const get = mock(
    async ({ archiveId }: { archiveId: string; userId: string }) =>
      cachedSignedPmtilesUrls[archiveId] ?? null,
  );
  const set = mock(async () => undefined);
  const pmtilesSignedUrls = {
    get,
    reset: mock(async () => 1),
    set,
  } satisfies OpenBeaconCache["pmtilesSignedUrls"];

  return {
    cache: { pmtilesSignedUrls } as OpenBeaconCache,
    get,
    set,
  };
};

const createUnavailableCache = () => {
  const unavailable = async () => {
    throw Object.assign(new Error("Connection has failed"), {
      code: "ERR_REDIS_CONNECTION_CLOSED",
    });
  };
  const pmtilesSignedUrls = {
    get: mock(unavailable),
    reset: mock(unavailable),
    set: mock(unavailable),
  } satisfies OpenBeaconCache["pmtilesSignedUrls"];
  return { pmtilesSignedUrls } as OpenBeaconCache;
};

const createSigner = (url: string, expiresAt: string) =>
  mock(async (_key: string) => ({ expiresAt, url }));

const oldArchive = {
  build: "20261001",
  id: "a-20261001",
  key: "planet-a.pmtiles",
  slot: "a" as const,
};
const currentArchive = {
  build: "20261101",
  id: "b-20261101",
  key: "planet-b.pmtiles",
  slot: "b" as const,
};

const importPmtilesUrl = async (): Promise<typeof import("./pmtilesUrl.ts")> =>
  import(`./pmtilesUrl.ts?test=${Math.random().toString(36).slice(2)}`);

describe("pmtilesUrl", () => {
  const envSnapshot = withEnvSnapshot(pmtilesUrlTestEnvKeys);

  beforeEach(() => {
    envSnapshot.save();
    process.env.IMAGES_S3_ENDPOINT = "https://images-storage.example.com";
    process.env.IMAGES_S3_REGION = "us-east-1";
    process.env.IMAGES_S3_CDN_URL = "https://cdn.example.com/file";
    process.env.MAP_S3_REGION = "us-east-1";
    process.env.IMAGES_S3_ACCESS_KEY_ID = "12345678901234567890";
    process.env.IMAGES_S3_ACCESS_KEY = "12345678901234567890";
    process.env.IMAGES_S3_BUCKET_NAME = "test-s3-bucket";
    process.env.MAP_S3_ENDPOINT = "https://map-storage.example.com";
    process.env.MAP_S3_ACCESS_KEY_ID = "test-storage-access-key-id";
    process.env.MAP_S3_ACCESS_KEY = "test-storage-secret-access-key";
    process.env.MAP_S3_BUCKET_NAME = "test-storage-bucket";
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  test("returns a cached url for the same archive when more than a minute remains", async () => {
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const now = new Date("2026-03-31T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 60_001).toISOString();
    const { cache, get, set } = createCache({
      cachedSignedPmtilesUrls: {
        "a-20261001": { expiresAt, url: "https://cached.example/pmtiles" },
      },
    });
    const createSignedUrl = mock(async (_key: string) => {
      throw new Error("createSignedPmtilesUrl should not be called");
    });
    const resolve = mock(async (_requestedId: string | undefined) => oldArchive);

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      now: () => now.getTime(),
      requestedArchiveId: "a-20261001",
      resolvePmtilesArchive: resolve,
      userId: "user-1",
    });

    expect(resolve).toHaveBeenCalledWith("a-20261001");
    expect(get).toHaveBeenCalledWith({ archiveId: "a-20261001", userId: "user-1" });
    expect(set).not.toHaveBeenCalled();
    expect(result).toEqual({
      archiveId: "a-20261001",
      expiresAt,
      key: "planet-a.pmtiles",
      mapBuild: "20261001",
      mapSlot: "a",
      refreshAt: "2026-03-31T12:00:00.001Z",
      source: "cached",
      url: "https://cached.example/pmtiles",
    });
  });

  test("never reuses a url signed for an earlier build of the same slot", async () => {
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const now = new Date("2026-03-31T12:00:00.000Z");
    const { cache, set } = createCache({
      cachedSignedPmtilesUrls: {
        "b-20260901": {
          expiresAt: new Date(now.getTime() + 300_000).toISOString(),
          url: "https://cached.example/old",
        },
      },
    });
    const createSignedUrl = createSigner("https://signed.example/new", "2026-03-31T12:10:00.000Z");

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      now: () => now.getTime(),
      requestedArchiveId: "b-20260901",
      resolvePmtilesArchive: async () => currentArchive,
      userId: "user-1",
    });

    expect(createSignedUrl).toHaveBeenCalledWith("planet-b.pmtiles");
    expect(set).toHaveBeenCalledWith({
      archiveId: "b-20261101",
      expiresAt: "2026-03-31T12:10:00.000Z",
      url: "https://signed.example/new",
      userId: "user-1",
    });
    expect(result).toMatchObject({ archiveId: "b-20261101", source: "generated" });
  });

  test("generates a new url when a cached value has one minute or less remaining", async () => {
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const now = new Date("2026-03-31T12:00:00.000Z");
    const { cache, set } = createCache({
      cachedSignedPmtilesUrls: {
        "b-20261101": {
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          url: "https://cached.example/pmtiles",
        },
      },
    });
    const createSignedUrl = createSigner(
      "https://replacement.example/pmtiles",
      "2026-03-31T12:10:00.000Z",
    );

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      now: () => now.getTime(),
      requestedArchiveId: "b-20261101",
      resolvePmtilesArchive: async () => currentArchive,
      userId: "user-1",
    });

    expect(set).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      archiveId: "b-20261101",
      expiresAt: "2026-03-31T12:10:00.000Z",
      key: "planet-b.pmtiles",
      mapBuild: "20261101",
      mapSlot: "b",
      refreshAt: "2026-03-31T12:09:00.000Z",
      source: "generated",
      url: "https://replacement.example/pmtiles",
    });
  });

  test("force refresh signs the current archive and overwrites the cached value", async () => {
    const { forceRefreshSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const { cache, set } = createCache();
    const createSignedUrl = createSigner(
      "https://forced.example/pmtiles",
      "2026-03-31T12:10:00.000Z",
    );
    const resolve = mock(async (_requestedId: string | undefined) => currentArchive);

    const result = await forceRefreshSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      resolvePmtilesArchive: resolve,
      userId: "user-1",
    });

    expect(resolve).toHaveBeenCalledWith(undefined);
    expect(set).toHaveBeenCalledWith({
      archiveId: "b-20261101",
      expiresAt: "2026-03-31T12:10:00.000Z",
      url: "https://forced.example/pmtiles",
      userId: "user-1",
    });
    expect(result).toMatchObject({ archiveId: "b-20261101", source: "forced" });
  });

  test("signs a fresh url without the cache while Redis is unavailable", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const expiresAt = "2026-03-31T13:00:00.000Z";
    const result = await getSignedPmtilesUrlForUser({
      cache: createUnavailableCache(),
      createSignedPmtilesUrl: createSigner("https://fresh.example/pmtiles", expiresAt),
      now: () => new Date("2026-03-31T12:00:00.000Z").getTime(),
      requestedArchiveId: undefined,
      resolvePmtilesArchive: async () => currentArchive,
      userId: "user-1",
    });
    expect(result).toMatchObject({ source: "generated", url: "https://fresh.example/pmtiles" });
    expect(error.mock.calls).toEqual([
      [
        "[pmtiles] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so the URL cache is bypassed",
      ],
      [
        "[pmtiles] Redis is unavailable (ERR_REDIS_CONNECTION_CLOSED), so the URL cache is bypassed",
      ],
    ]);
    error.mockRestore();
  });
});
