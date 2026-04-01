import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { OpenBeaconCache } from "@openbeacon/cache";

const createCache = ({
  cachedSignedPmtilesUrl = null,
}: {
  cachedSignedPmtilesUrl?: {
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

describe("pmtilesUrl", () => {
  let originalR2AccessKeyId: string | undefined;
  let originalR2AccountId: string | undefined;
  let originalR2Bucket: string | undefined;
  let originalR2PmTilesKey: string | undefined;
  let originalR2SecretAccessKey: string | undefined;
  let originalS3AccessKey: string | undefined;
  let originalS3AccessKeyId: string | undefined;
  let originalS3BucketName: string | undefined;

  beforeEach(() => {
    originalS3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
    originalS3AccessKey = process.env.S3_ACCESS_KEY;
    originalS3BucketName = process.env.S3_BUCKET_NAME;
    originalR2AccountId = process.env.R2_ACCOUNT_ID;
    originalR2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
    originalR2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    originalR2Bucket = process.env.R2_BUCKET;
    originalR2PmTilesKey = process.env.R2_PM_TILES_KEY;
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
    if (originalS3AccessKeyId === undefined) {
      delete process.env.S3_ACCESS_KEY_ID;
    } else {
      process.env.S3_ACCESS_KEY_ID = originalS3AccessKeyId;
    }

    if (originalS3AccessKey === undefined) {
      delete process.env.S3_ACCESS_KEY;
    } else {
      process.env.S3_ACCESS_KEY = originalS3AccessKey;
    }

    if (originalS3BucketName === undefined) {
      delete process.env.S3_BUCKET_NAME;
    } else {
      process.env.S3_BUCKET_NAME = originalS3BucketName;
    }

    if (originalR2AccountId === undefined) {
      delete process.env.R2_ACCOUNT_ID;
    } else {
      process.env.R2_ACCOUNT_ID = originalR2AccountId;
    }

    if (originalR2AccessKeyId === undefined) {
      delete process.env.R2_ACCESS_KEY_ID;
    } else {
      process.env.R2_ACCESS_KEY_ID = originalR2AccessKeyId;
    }

    if (originalR2SecretAccessKey === undefined) {
      delete process.env.R2_SECRET_ACCESS_KEY;
    } else {
      process.env.R2_SECRET_ACCESS_KEY = originalR2SecretAccessKey;
    }

    if (originalR2Bucket === undefined) {
      delete process.env.R2_BUCKET;
    } else {
      process.env.R2_BUCKET = originalR2Bucket;
    }

    if (originalR2PmTilesKey === undefined) {
      delete process.env.R2_PM_TILES_KEY;
    } else {
      process.env.R2_PM_TILES_KEY = originalR2PmTilesKey;
    }
  });

  test("returns a cached url when more than a minute remains", async () => {
    const { getSignedPmtilesUrlForUser }: typeof import("./pmtilesUrl.ts") = await import(
      `./pmtilesUrl.ts?test=${Math.random().toString(36).slice(2)}`
    );
    const now = new Date("2026-03-31T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 60_001).toISOString();
    const { cache, get, set } = createCache({
      cachedSignedPmtilesUrl: {
        expiresAt,
        url: "https://cached.example/pmtiles",
      },
    });
    const createSignedUrl = mock(async () => {
      throw new Error("createSignedPmtilesUrl should not be called");
    });

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      now: () => now.getTime(),
      userId: "user-1",
    });

    expect(get).toHaveBeenCalledWith({
      userId: "user-1",
    });
    expect(set).not.toHaveBeenCalled();
    expect(result).toEqual({
      expiresAt,
      refreshAt: "2026-03-31T12:00:00.001Z",
      source: "cached",
      url: "https://cached.example/pmtiles",
    });
  });

  test("generates and persists a new url when no cached value exists", async () => {
    const { getSignedPmtilesUrlForUser }: typeof import("./pmtilesUrl.ts") = await import(
      `./pmtilesUrl.ts?test=${Math.random().toString(36).slice(2)}`
    );
    const { cache, set } = createCache();
    const expiresAt = "2026-03-31T12:10:00.000Z";
    const createSignedUrl = mock(async () => ({
      expiresAt,
      url: "https://generated.example/pmtiles",
    }));

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      userId: "user-1",
    });

    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      expiresAt,
      url: "https://generated.example/pmtiles",
      userId: "user-1",
    });
    expect(result).toEqual({
      expiresAt,
      refreshAt: "2026-03-31T12:09:00.000Z",
      source: "generated",
      url: "https://generated.example/pmtiles",
    });
  });

  test("generates and persists a new url when a cached value has one minute or less remaining", async () => {
    const { getSignedPmtilesUrlForUser }: typeof import("./pmtilesUrl.ts") = await import(
      `./pmtilesUrl.ts?test=${Math.random().toString(36).slice(2)}`
    );
    const now = new Date("2026-03-31T12:00:00.000Z");
    const { cache, set } = createCache({
      cachedSignedPmtilesUrl: {
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        url: "https://cached.example/pmtiles",
      },
    });
    const createSignedUrl = mock(async () => ({
      expiresAt: "2026-03-31T12:10:00.000Z",
      url: "https://replacement.example/pmtiles",
    }));

    const result = await getSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      now: () => now.getTime(),
      userId: "user-1",
    });

    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      expiresAt: "2026-03-31T12:10:00.000Z",
      refreshAt: "2026-03-31T12:09:00.000Z",
      source: "generated",
      url: "https://replacement.example/pmtiles",
    });
  });

  test("force refresh always regenerates and overwrites the cached value", async () => {
    const { forceRefreshSignedPmtilesUrlForUser }: typeof import("./pmtilesUrl.ts") = await import(
      `./pmtilesUrl.ts?test=${Math.random().toString(36).slice(2)}`
    );
    const { cache, set } = createCache();
    const createSignedUrl = mock(async () => ({
      expiresAt: "2026-03-31T12:10:00.000Z",
      url: "https://forced.example/pmtiles",
    }));

    const result = await forceRefreshSignedPmtilesUrlForUser({
      cache,
      createSignedPmtilesUrl: createSignedUrl,
      userId: "user-1",
    });

    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      expiresAt: "2026-03-31T12:10:00.000Z",
      url: "https://forced.example/pmtiles",
      userId: "user-1",
    });
    expect(result).toEqual({
      expiresAt: "2026-03-31T12:10:00.000Z",
      refreshAt: "2026-03-31T12:09:00.000Z",
      source: "forced",
      url: "https://forced.example/pmtiles",
    });
  });
});
