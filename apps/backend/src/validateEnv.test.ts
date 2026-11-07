import { describe, expect, test } from "bun:test";

describe("production environment validation", () => {
  const env = {
    ...process.env,
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
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
    const output = result.stdout.toString();
    expect(output).toContain("DATABASE_URL: valid");
    expect(output).toContain("Environment configuration valid");
    expect(output).not.toContain(env.BETTER_AUTH_SECRET);
  });

  test("accepts HTTP public URLs", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, `${import.meta.dir}/validateEnv.ts`],
      env: {
        ...env,
        BETTER_AUTH_URL: "http://localhost:3000",
        S3_CDN_URL: "http://localhost:9000",
      },
    });
    expect(result.exitCode).toBe(0);
  });

  test("accepts paired Google credentials", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, `${import.meta.dir}/validateEnv.ts`],
      env: { ...env, GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" },
    });
    expect(result.exitCode).toBe(0);
  });

  test("rejects invalid proxy and storage configuration", () => {
    for (const invalid of [
      { TRUSTED_PROXY_PROVIDER: "" },
      { CLOUDFLARE_ORIGIN_SECRET: "" },
      { R2_BUCKET: "" },
      { BETTER_AUTH_URL: "ftp://example.com" },
      { S3_CDN_URL: "mailto:test@example.com" },
      { DATABASE_URL: "https://example.com" },
      { DATABASE_URL: "not-a-url" },
      { REDIS_URL: "not-a-url" },
      { GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "" },
      { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "client-secret" },
      { REDIS_URL: "https://example.com" },
      { OPENBEACON_API_PORT: "1.5" },
      { S3_ENDPOINT: "invalid" },
      { S3_REGION: "" },
      { MAX_IMAGE_FILE_SIZE: "0" },
      { SELF_HOSTED: "maybe" },
    ]) {
      const result = Bun.spawnSync({
        cmd: [process.execPath, `${import.meta.dir}/validateEnv.ts`],
        env: { ...env, ...invalid },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("Environment configuration validation failed");
      expect(result.stdout.toString()).toContain("R2_PM_TILES_KEY: valid");
    }
  });
});
