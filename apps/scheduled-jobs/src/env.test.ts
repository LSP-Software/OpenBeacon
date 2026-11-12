import { expect, test } from "bun:test";

test("requires a PostgreSQL database URL", () => {
  for (const [databaseUrl, valid] of [
    ["postgresql://localhost:5432/test", true],
    ["postgres://localhost/test", true],
    ["https://example.com", false],
    ["", false],
  ] as const) {
    const result = Bun.spawnSync({
      cmd: [process.execPath, `${import.meta.dir}/env.ts`],
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    expect(result.exitCode === 0).toBe(valid);
  }
});

test("stops the runner with a clear line when the email settings are invalid", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, `${import.meta.dir}/index.ts`],
    env: {
      ...process.env,
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

test("requires the map tiles service URL and key together", () => {
  for (const [env, valid] of [
    [{}, true],
    [{ MAP_TILES_SERVICE_URL: "http://map-tiles:8080", MAP_TILES_API_KEY: "k".repeat(32) }, true],
    [{ MAP_TILES_SERVICE_URL: "http://map-tiles:8080" }, false],
    [{ MAP_TILES_API_KEY: "k".repeat(32) }, false],
    [{ MAP_TILES_SERVICE_URL: "http://map-tiles:8080", MAP_TILES_API_KEY: "short" }, false],
    [{ MAP_TILES_SERVICE_URL: "ftp://map-tiles", MAP_TILES_API_KEY: "k".repeat(32) }, false],
  ] as const) {
    const result = Bun.spawnSync({
      cmd: [process.execPath, `${import.meta.dir}/env.ts`],
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://localhost:5432/test",
        MAP_TILES_SERVICE_URL: "",
        MAP_TILES_API_KEY: "",
        ...env,
      },
    });
    expect(result.exitCode === 0).toBe(valid);
  }
});
