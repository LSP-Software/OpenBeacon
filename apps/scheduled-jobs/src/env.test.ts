import { expect, test } from "bun:test";
import { emailEnvSchema } from "@openbeacon/email/config.ts";

const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !(name in emailEnvSchema)),
);

test("requires a PostgreSQL database URL", () => {
  for (const [databaseUrl, valid] of [
    ["postgresql://localhost:5432/test", true],
    ["postgres://localhost/test", true],
    ["https://example.com", false],
    ["not-a-url", false],
    ["", false],
  ] as const) {
    const result = Bun.spawnSync({
      cmd: [process.execPath, `${import.meta.dir}/env.ts`],
      env: { ...env, DATABASE_URL: databaseUrl },
    });
    expect(result.exitCode === 0).toBe(valid);
  }
});

test("lists each setting by name without printing its value", () => {
  const secret = "runner-secret-access-key-value";
  const result = Bun.spawnSync({
    cmd: [process.execPath, `${import.meta.dir}/env.ts`],
    env: {
      ...env,
      DATABASE_URL: "postgresql://runner:database-password@localhost:5432/test",
      IMAGES_S3_ACCESS_KEY: secret,
    },
  });
  const output = result.stdout.toString() + result.stderr.toString();
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Environment configuration:");
  expect(output).toContain("  DATABASE_URL: valid");
  expect(output).toContain("  IMAGES_S3_ACCESS_KEY: valid");
  expect(output).toContain("  RESEND_API_KEY: not set (optional/default)");
  expect(output).toContain("Environment configuration valid");
  expect(output).not.toContain(secret);
  expect(output).not.toContain("database-password");
});

test("stops the runner with a clear line before the storage clients read a bad setting", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, `${import.meta.dir}/index.ts`],
    env: {
      ...env,
      DATABASE_URL: "postgresql://localhost:5432/test",
      IMAGES_S3_ENDPOINT: "short-secret",
    },
  });
  const stderr = result.stderr.toString();
  expect(result.exitCode).not.toBe(0);
  expect(stderr).toContain("  IMAGES_S3_ENDPOINT: invalid (");
  expect(stderr).toContain("Environment configuration validation failed");
  expect(stderr).not.toContain("short-secret");
  expect(stderr).not.toContain("Invalid environment variables");
});

test("stops the runner with a clear line when the email settings are invalid", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, `${import.meta.dir}/index.ts`],
    env: {
      ...env,
      DATABASE_URL: "postgresql://localhost:5432/test",
      EMAIL_CONSOLE: "true",
      NODE_ENV: "production",
    },
  });
  const stderr = result.stderr.toString();
  expect(result.exitCode).not.toBe(0);
  expect(stderr).toContain(
    "  Email: EMAIL_CONSOLE is only allowed when NODE_ENV is development or test",
  );
  expect(stderr).toContain("Environment configuration validation failed");
  expect(stderr).not.toContain("at resolveEmailConfig");
  expect(stderr).not.toContain("at loadEmailSettings");
});
