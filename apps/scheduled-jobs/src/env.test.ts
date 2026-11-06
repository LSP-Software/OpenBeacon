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
