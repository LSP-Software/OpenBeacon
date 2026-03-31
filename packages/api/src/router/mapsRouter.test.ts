import { afterEach, beforeEach, describe, expect, test } from "bun:test";

let originalBetterAuthUrl: string | undefined;
let originalBetterAuthSecret: string | undefined;
let originalDatabaseUrl: string | undefined;
let originalNodeEnv: string | undefined;
let originalR2AccessKeyId: string | undefined;
let originalR2AccountId: string | undefined;
let originalR2Bucket: string | undefined;
let originalR2PmTilesKey: string | undefined;
let originalR2SecretAccessKey: string | undefined;
let originalS3AccessKey: string | undefined;
let originalS3AccessKeyId: string | undefined;
let originalS3BucketName: string | undefined;

describe("mapsRouter", () => {
  beforeEach(() => {
    originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
    originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalS3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
    originalS3AccessKey = process.env.S3_ACCESS_KEY;
    originalS3BucketName = process.env.S3_BUCKET_NAME;
    originalR2AccountId = process.env.R2_ACCOUNT_ID;
    originalR2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
    originalR2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    originalR2Bucket = process.env.R2_BUCKET;
    originalR2PmTilesKey = process.env.R2_PM_TILES_KEY;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "test-secret-000000000000000000000000";
    process.env.DATABASE_URL = "postgresql://localhost:5432/openbeacon";
    process.env.NODE_ENV = "production";
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
    if (originalBetterAuthUrl === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
    }

    if (originalBetterAuthSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
    }

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

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

  test("configures the force refresh route with a strict ten minute rate limit", async () => {
    const cacheBuster = `test=${Math.random().toString(36).slice(2)}`;
    const { mapsRouter }: typeof import("./mapsRouter.ts") = await import(
      `./mapsRouter.ts?${cacheBuster}`
    );

    expect(mapsRouter.forceRefreshSignedPmtilesUrl._def.meta).toEqual({
      rateLimit: {
        limit: 3,
        windowMs: 600_000,
      },
    });
  });
});
