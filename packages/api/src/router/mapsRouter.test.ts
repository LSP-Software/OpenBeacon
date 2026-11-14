import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const testEnv = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-000000000000000000000000",
  DATABASE_URL: "postgresql://localhost:5432/openbeacon",
  NODE_ENV: "production",
  IMAGES_S3_ENDPOINT: "https://images-storage.example.com",
  IMAGES_S3_REGION: "us-east-1",
  IMAGES_S3_ACCESS_KEY_ID: "test-images-access-key-id",
  IMAGES_S3_ACCESS_KEY: "test-images-secret-access-key",
  IMAGES_S3_BUCKET_NAME: "test-images-bucket",
  IMAGES_S3_CDN_URL: "https://cdn.example.com/file",
  MAP_S3_ENDPOINT: "https://map-storage.example.com",
  MAP_S3_REGION: "us-east-1",
  MAP_S3_ACCESS_KEY_ID: "test-storage-access-key-id",
  MAP_S3_ACCESS_KEY: "test-storage-secret-access-key",
  MAP_S3_BUCKET_NAME: "test-storage-bucket",
};

describe("mapsRouter", () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const [key, value] of Object.entries(testEnv)) {
      original.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
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
