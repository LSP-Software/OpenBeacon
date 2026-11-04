import { describe, expect, test } from "bun:test";

describe("production environment validation", () => {
  const env = {
    ...process.env,
    DATABASE_URL: "postgresql://localhost:5432/openbeacon",
    REDIS_URL: "redis://localhost:6379",
    BETTER_AUTH_URL: "https://api.openbeacon.net",
    BETTER_AUTH_SECRET: "test-secret-000000000000000000000000",
    TRUSTED_PROXY_PROVIDER: "cloudflare-authenticated",
    CLOUDFLARE_ORIGIN_SECRET: "a-secure-test-secret-with-32-characters",
    S3_ACCESS_KEY_ID: "12345678901234567890",
    S3_ACCESS_KEY: "12345678901234567890",
    S3_BUCKET_NAME: "test-bucket",
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET: "test-bucket",
    R2_PM_TILES_KEY: "test.pmtiles",
  };

  test("accepts valid runtime configuration", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, `${import.meta.dir}/validateEnv.ts`],
      env,
    });
    expect(result.exitCode).toBe(0);
  });

  test("rejects invalid proxy and storage configuration", () => {
    for (const invalid of [
      { TRUSTED_PROXY_PROVIDER: "" },
      { CLOUDFLARE_ORIGIN_SECRET: "" },
      { R2_BUCKET: "" },
    ]) {
      const result = Bun.spawnSync({
        cmd: [process.execPath, `${import.meta.dir}/validateEnv.ts`],
        env: { ...env, ...invalid },
      });
      expect(result.exitCode).not.toBe(0);
    }
  });
});
