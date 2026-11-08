import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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
  "S3_ACCESS_KEY_ID",
  "S3_ACCESS_KEY",
  "S3_BUCKET_NAME",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PM_TILES_KEY",
] as const;

const createCache = ({
  cachedSignedPmtilesUrl = null,
}: {
  cachedSignedPmtilesUrl?: {
    archiveKey: string;
    expiresAt: string;
    url: string;
  } | null;
} = {}) => {
  const get = mock(async () => cachedSignedPmtilesUrl);
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

const createSigner = (url: string, expiresAt: string) =>
  mock(async (archiveKey: string) => ({ archiveKey, expiresAt, url }));

const importPmtilesUrl = async (): Promise<typeof import("./pmtilesUrl.ts")> =>
  import(`./pmtilesUrl.ts?test=${Math.random().toString(36).slice(2)}`);

describe("pmtilesUrl", () => {
  const envSnapshot = withEnvSnapshot(pmtilesUrlTestEnvKeys);

  beforeEach(() => {
    envSnapshot.save();
    process.env.S3_ACCESS_KEY_ID = "12345678901234567890";
    process.env.S3_ACCESS_KEY = "12345678901234567890";
    process.env.S3_BUCKET_NAME = "test-s3-bucket";
    process.env.R2_ACCOUNT_ID = "test-r2-account-id";
    process.env.R2_ACCESS_KEY_ID = "test-r2-access-key-id";
    process.env.R2_SECRET_ACCESS_KEY = "test-r2-secret-access-key";
    process.env.R2_BUCKET = "test-r2-bucket";
    process.env.R2_PM_TILES_KEY = "pmtiles/test.pmtiles";
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  test("returns a cached url for the same archive when more than a minute remains", async () => {
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const now = new Date("2026-03-31T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 60_001).toISOString();
    const { cache, get, set } = createCache({
      cachedSignedPmtilesUrl: {
        archiveKey: "planet-old.pmtiles",
        expiresAt,
        url: "https://cached.example/pmtiles",
      },
    });
    const createSignedUrl = mock(async (_archiveKey: string) => {
      throw new Error("createSignedPmtilesUrl should not be called");
    });
    const resolve = mock(async (requestedKey: string | undefined) => requestedKey ?? "current");

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      now: () => now.getTime(),
      requestedArchiveKey: "planet-old.pmtiles",
      resolvePmtilesArchiveKey: resolve,
      userId: "user-1",
    });

    expect(resolve).toHaveBeenCalledWith("planet-old.pmtiles");
    expect(get).toHaveBeenCalledWith({ userId: "user-1" });
    expect(set).not.toHaveBeenCalled();
    expect(result).toEqual({
      archiveKey: "planet-old.pmtiles",
      expiresAt,
      refreshAt: "2026-03-31T12:00:00.001Z",
      source: "cached",
      url: "https://cached.example/pmtiles",
    });
  });

  test("signs the resolved archive when the cached url is for a different archive", async () => {
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const now = new Date("2026-03-31T12:00:00.000Z");
    const { cache, set } = createCache({
      cachedSignedPmtilesUrl: {
        archiveKey: "planet-old.pmtiles",
        expiresAt: new Date(now.getTime() + 300_000).toISOString(),
        url: "https://cached.example/old",
      },
    });
    const createSignedUrl = createSigner("https://signed.example/new", "2026-03-31T12:10:00.000Z");

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      now: () => now.getTime(),
      requestedArchiveKey: "planet-old.pmtiles",
      resolvePmtilesArchiveKey: async () => "planet-new.pmtiles",
      userId: "user-1",
    });

    expect(createSignedUrl).toHaveBeenCalledWith("planet-new.pmtiles");
    expect(set).toHaveBeenCalledWith({
      archiveKey: "planet-new.pmtiles",
      expiresAt: "2026-03-31T12:10:00.000Z",
      url: "https://signed.example/new",
      userId: "user-1",
    });
    expect(result.archiveKey).toBe("planet-new.pmtiles");
    expect(result.source).toBe("generated");
  });

  test("generates and persists a new url when no cached value exists", async () => {
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const { cache, set } = createCache();
    const expiresAt = "2026-03-31T12:10:00.000Z";
    const createSignedUrl = createSigner("https://generated.example/pmtiles", expiresAt);

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      requestedArchiveKey: undefined,
      resolvePmtilesArchiveKey: async () => "current",
      userId: "user-1",
    });

    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      archiveKey: "current",
      expiresAt,
      url: "https://generated.example/pmtiles",
      userId: "user-1",
    });
    expect(result).toEqual({
      archiveKey: "current",
      expiresAt,
      refreshAt: "2026-03-31T12:09:00.000Z",
      source: "generated",
      url: "https://generated.example/pmtiles",
    });
  });

  test("generates and persists a new url when a cached value has one minute or less remaining", async () => {
    const { getSignedPmtilesUrlForUser } = await importPmtilesUrl();
    const now = new Date("2026-03-31T12:00:00.000Z");
    const { cache, set } = createCache({
      cachedSignedPmtilesUrl: {
        archiveKey: "current",
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        url: "https://cached.example/pmtiles",
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
      requestedArchiveKey: "current",
      resolvePmtilesArchiveKey: async () => "current",
      userId: "user-1",
    });

    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      archiveKey: "current",
      expiresAt: "2026-03-31T12:10:00.000Z",
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
    const resolve = mock(async (_requestedKey: string | undefined) => "current");

    const result = await forceRefreshSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      resolvePmtilesArchiveKey: resolve,
      userId: "user-1",
    });

    expect(resolve).toHaveBeenCalledWith(undefined);
    expect(set).toHaveBeenCalledWith({
      archiveKey: "current",
      expiresAt: "2026-03-31T12:10:00.000Z",
      url: "https://forced.example/pmtiles",
      userId: "user-1",
    });
    expect(result).toEqual({
      archiveKey: "current",
      expiresAt: "2026-03-31T12:10:00.000Z",
      refreshAt: "2026-03-31T12:09:00.000Z",
      source: "forced",
      url: "https://forced.example/pmtiles",
    });
  });
});
