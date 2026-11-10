import { describe, expect, test } from "bun:test";
import { buildIntegrationTestCommand } from "./integration-tests.ts";

const files = [
  "apps/backend/src/routes/trpcFeedback.integration.test.ts",
  "packages/cache/src/cache/OpenBeaconCache.integration.test.ts",
  "packages/cache-extra/src/extra.integration.test.ts",
];

describe("buildIntegrationTestCommand", () => {
  test("runs every file with the CI env file by default", () => {
    expect(buildIntegrationTestCommand({ files, args: [] })).toEqual({
      command: ["bun", "test", "--isolate", "--env-file=.env.ci", ...files],
    });
  });

  test("narrows to files under the given directories without matching sibling prefixes", () => {
    expect(buildIntegrationTestCommand({ files, args: ["./packages/cache/"] })).toEqual({
      command: ["bun", "test", "--isolate", "--env-file=.env.ci", files[1] ?? ""],
    });
  });

  test("replaces the default env file when one is passed and forwards other flags", () => {
    expect(
      buildIntegrationTestCommand({ files, args: ["--env-file=/tmp/env.test", "--bail"] }),
    ).toEqual({
      command: ["bun", "test", "--isolate", "--env-file=/tmp/env.test", "--bail", ...files],
    });
  });

  test("fails when no files are found", () => {
    expect(buildIntegrationTestCommand({ files: [], args: [] })).toEqual({
      error: "No integration test files (*.integration.test.ts) found under apps/ or packages/.",
    });
    expect(buildIntegrationTestCommand({ files, args: ["packages/nope"] })).toEqual({
      error: "No integration test files found under packages/nope.",
    });
  });
});
