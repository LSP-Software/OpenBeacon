import { describe, expect, test } from "bun:test";
import { testRedisHashSecret } from "@openbeacon/cache/testing";

describe("production environment validation", () => {
  const env = {
    ...process.env,
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    DATABASE_URL: "postgresql://localhost:5432/openbeacon",
    REDIS_URL: "redis://localhost:6379",
    REDIS_HASH_SECRET: testRedisHashSecret,
    BETTER_AUTH_URL: "https://api.openbeacon.net",
    BETTER_AUTH_SECRET: "test-secret-000000000000000000000000",
    TRUSTED_PROXY_PROVIDER: "cloudflare-authenticated",
    CLOUDFLARE_ORIGIN_SECRET: "a-secure-test-secret-with-32-characters",
    IMAGES_S3_ENDPOINT: "https://images-storage.example.com",
    IMAGES_S3_REGION: "us-east-1",
    IMAGES_S3_CDN_URL: "https://cdn.example.com/file",
    IMAGES_S3_ACCESS_KEY_ID: "12345678901234567890",
    IMAGES_S3_ACCESS_KEY: "12345678901234567890",
    IMAGES_S3_BUCKET_NAME: "test-bucket",
    MAP_S3_ENDPOINT: "https://map-storage.example.com",
    MAP_S3_REGION: "us-east-1",
    MAP_S3_ACCESS_KEY_ID: "test-key",
    MAP_S3_ACCESS_KEY: "test-secret",
    MAP_S3_BUCKET_NAME: "test-bucket",
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
        IMAGES_S3_CDN_URL: "http://localhost:9000",
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

  test("accepts an SMTP email provider", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, `${import.meta.dir}/validateEnv.ts`],
      env: { ...env, SMTP_HOST: "smtp.example.com", EMAIL_FROM: "noreply@example.com" },
    });
    expect(result.exitCode).toBe(0);
  });

  test("rejects invalid proxy and storage configuration", () => {
    for (const invalid of [
      { TRUSTED_PROXY_PROVIDER: "" },
      { CLOUDFLARE_ORIGIN_SECRET: "" },
      { MAP_S3_BUCKET_NAME: "" },
      { BETTER_AUTH_URL: "ftp://example.com" },
      { IMAGES_S3_CDN_URL: "mailto:test@example.com" },
      { DATABASE_URL: "https://example.com" },
      { DATABASE_URL: "not-a-url" },
      { REDIS_URL: "not-a-url" },
      { GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "" },
      { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "client-secret" },
      { REDIS_URL: "https://example.com" },
      { REDIS_HASH_SECRET: "short" },
      { OPENBEACON_API_PORT: "1.5" },
      { IMAGES_S3_ENDPOINT: "invalid" },
      { IMAGES_S3_PUBLIC_ENDPOINT: "beacon.example.com" },
      { MAP_S3_PUBLIC_ENDPOINT: "https://beacon.example.com/openbeacon-map" },
      { IMAGES_S3_REGION: "" },
      { MAX_IMAGE_FILE_SIZE: "0" },
      { SELF_HOSTED: "maybe" },
      { RESEND_API_KEY: "re_key", SMTP_HOST: "smtp.example.com", EMAIL_FROM: "a@example.com" },
      { RESEND_API_KEY: "re_key" },
      { EMAIL_FROM: "noreply@example.com" },
      { EMAIL_CONSOLE: "true", NODE_ENV: "production" },
    ]) {
      const result = Bun.spawnSync({
        cmd: [process.execPath, `${import.meta.dir}/validateEnv.ts`],
        env: { ...env, ...invalid },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("Environment configuration validation failed");
      expect(result.stdout.toString()).toContain("MAP_S3_ACCESS_KEY: valid");
    }
  }, 30_000);

  test("stops the backend with a clear line when the email settings are invalid", () => {
    for (const [invalid, message] of [
      [{ EMAIL_CONSOLE: "true", NODE_ENV: "production" }, "EMAIL_CONSOLE is only allowed"],
      [{ EMAIL_FROM: "noreply@example.com" }, "EMAIL_FROM needs RESEND_API_KEY or SMTP_HOST"],
    ] as const) {
      const result = Bun.spawnSync({
        cmd: [process.execPath, `${import.meta.dir}/index.ts`],
        env: { ...env, ...invalid },
      });
      const stderr = result.stderr.toString();
      expect(result.exitCode).not.toBe(0);
      expect(stderr).toContain(`  Email: ${message}`);
      expect(stderr).toContain("Environment configuration validation failed");
      expect(stderr).not.toContain("at resolveEmailConfig");
      expect(stderr).not.toContain("at loadEmailSettings");
    }
  });
});
