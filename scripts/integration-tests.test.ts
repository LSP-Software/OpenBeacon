import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIntegrationTestCommand, readEnvFile } from "./integration-tests.ts";

const files = [
  "apps/backend/src/routes/trpcFeedback.integration.test.ts",
  "packages/cache/src/cache/OpenBeaconCache.integration.test.ts",
  "packages/cache-extra/src/extra.integration.test.ts",
];

describe("buildIntegrationTestCommand", () => {
  test("runs every file with the CI env file by default", () => {
    expect(buildIntegrationTestCommand({ files, args: [] })).toEqual({
      envFile: ".env.ci",
      command: ["bun", "test", "--isolate", "--env-file=.env.ci", ...files],
    });
  });

  test("narrows to files under the given directories without matching sibling prefixes", () => {
    expect(buildIntegrationTestCommand({ files, args: ["./packages/cache/"] })).toEqual({
      envFile: ".env.ci",
      command: ["bun", "test", "--isolate", "--env-file=.env.ci", files[1] ?? ""],
    });
  });

  test("replaces the default env file when one is passed and forwards other flags", () => {
    expect(
      buildIntegrationTestCommand({ files, args: ["--env-file=/tmp/env.test", "--bail=1"] }),
    ).toEqual({
      envFile: "/tmp/env.test",
      command: ["bun", "test", "--isolate", "--env-file=/tmp/env.test", "--bail=1", ...files],
    });
  });

  test("rejects flags whose value is a separate argument", () => {
    expect(
      buildIntegrationTestCommand({ files, args: ["--env-file", ".env.local", "packages/cache"] }),
    ).toEqual({
      error: "Pass flags as --flag=value: use --env-file=<value>, such as --env-file=<path>.",
    });
    expect(buildIntegrationTestCommand({ files, args: ["--bail"] })).toEqual({
      error: "Pass flags as --flag=value: use --bail=<value>, such as --env-file=<path>.",
    });
  });

  test("fails when no files are found or any path matches nothing", () => {
    expect(buildIntegrationTestCommand({ files: [], args: [] })).toEqual({
      error: "No integration test files (*.integration.test.ts) found under apps/ or packages/.",
    });
    expect(buildIntegrationTestCommand({ files, args: ["packages/nope"] })).toEqual({
      error: "No integration test files found under packages/nope.",
    });
    expect(buildIntegrationTestCommand({ files, args: ["packages/cache", "typo"] })).toEqual({
      error: "No integration test files found under typo.",
    });
  });
});

describe("readEnvFile", () => {
  test("parses the env file so its values can override the shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "integration-env-"));
    try {
      const envFile = join(dir, ".env.test");
      await Bun.write(
        envFile,
        '# comment\nDATABASE_URL=postgresql://localhost/openbeacon_test\nREDIS_URL="redis://localhost:6390"\n',
      );
      expect(await readEnvFile(envFile)).toEqual({
        DATABASE_URL: "postgresql://localhost/openbeacon_test",
        REDIS_URL: "redis://localhost:6390",
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("fails when the env file is missing", async () => {
    await expect(readEnvFile("/nonexistent/.env.test")).rejects.toThrow(
      "Env file /nonexistent/.env.test not found.",
    );
  });
});
