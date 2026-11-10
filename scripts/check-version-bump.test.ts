import { describe, expect, test } from "bun:test";
import {
  findMissingVersionBumps,
  parseApiCompatibilityLevels,
  parseClientVersion,
  parseServerVersion,
} from "./check-version-bump.ts";

const levels = { level: 3, minClient: 2, minServer: 3 };
const base = {
  client: { version: "1.0.4", buildNumber: 5, versionCode: 5 },
  server: "0.1.5",
  apiCompatibility: levels,
};
const bumped = {
  client: { version: "1.0.5", buildNumber: 6, versionCode: 6 },
  server: "0.1.6",
  apiCompatibility: levels,
};
const minorBump = {
  client: { version: "1.1.0", buildNumber: 6, versionCode: 6 },
  server: "0.2.0",
  apiCompatibility: levels,
};
const levelFile = ["packages/shared/src/apiCompatibilityLevel.ts"];

describe("findMissingVersionBumps", () => {
  test("allows changes that ship nothing without a bump", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: [
          "README.md",
          ".github/workflows/pre-merge-checks.yml",
          "apps/mobile/lib/map.test.ts",
          "packages/api/src/router/accountRouter.test.ts",
          "apps/mobile/modules/openbeacon-tracking/jvm/src/test/kotlin/Queue.kt",
          "apps/mobile/modules/openbeacon-tracking/android/src/androidTest/java/Queue.kt",
        ],
        base,
        head: base,
      }),
    ).toEqual([]);
  });

  test("requires every client version field to rise when client code changes", () => {
    expect(
      findMissingVersionBumps({ changedFiles: ["apps/mobile/app/index.tsx"], base, head: base }),
    ).toEqual([
      "Client code changed: raise expo.version in apps/mobile/app.json above 1.0.4.",
      "Client code changed: raise expo.ios.buildNumber in apps/mobile/app.json above 5.",
      "Client code changed: raise expo.android.versionCode in apps/mobile/app.json above 5.",
    ]);
  });

  test("requires only the server version when server-only code changes", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: ["packages/database/prisma/schema.prisma"],
        base,
        head: base,
      }),
    ).toEqual([
      "Server code changed: raise serverVersion in apps/backend/src/version.ts above 0.1.5.",
    ]);
  });

  test("treats new packages as server code but ignores the shared tsconfig", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: ["packages/notifications/src/index.ts"],
        base,
        head: base,
      }),
    ).toHaveLength(1);
    expect(
      findMissingVersionBumps({ changedFiles: ["packages/tsconfig/base.json"], base, head: base }),
    ).toEqual([]);
  });

  test("treats Docker build files, the lockfile and bunfig.toml as server code", () => {
    for (const file of [
      "Dockerfile",
      ".dockerignore",
      "apps/scheduled-jobs/.dockerignore",
      "bun.lock",
      "bunfig.toml",
    ]) {
      expect(findMissingVersionBumps({ changedFiles: [file], base, head: base })).toEqual([
        "Server code changed: raise serverVersion in apps/backend/src/version.ts above 0.1.5.",
      ]);
      expect(
        findMissingVersionBumps({ changedFiles: [file], base, head: { ...base, server: "0.1.6" } }),
      ).toEqual([]);
    }
  });

  test("only matches Docker, lockfile and bunfig paths exactly", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: ["docs/Dockerfile", "docs/bun.lock", "docs/bunfig.toml", "my.dockerignore"],
        base,
        head: base,
      }),
    ).toEqual([]);
  });

  test("requires both versions when a shared package changes", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: ["packages/encryption/src/personalData.ts"],
        base,
        head: { ...base, client: bumped.client },
      }),
    ).toEqual([
      "Server code changed: raise serverVersion in apps/backend/src/version.ts above 0.1.5.",
    ]);
    expect(
      findMissingVersionBumps({
        changedFiles: ["packages/encryption/src/personalData.ts"],
        base,
        head: bumped,
      }),
    ).toEqual([]);
  });

  test("compares versions numerically rather than as text", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: ["apps/backend/src/index.ts"],
        base: { ...base, server: "0.9.0" },
        head: { ...base, server: "0.10.0" },
      }),
    ).toEqual([]);
    expect(
      findMissingVersionBumps({
        changedFiles: ["apps/backend/src/index.ts"],
        base: { ...base, server: "0.10.0" },
        head: { ...base, server: "0.9.9" },
      }),
    ).toHaveLength(1);
  });
});

describe("API compatibility levels", () => {
  test("allows raising the level by one with a minor bump on both sides", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: { ...minorBump, apiCompatibility: { level: 4, minClient: 2, minServer: 4 } },
      }),
    ).toEqual([]);
  });

  test("allows retiring old apps by raising only the client minimum", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: { ...minorBump, apiCompatibility: { ...levels, minClient: 3 } },
      }),
    ).toEqual([]);
  });

  test("requires a minor bump of both versions when a level changes", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: { ...bumped, apiCompatibility: { level: 4, minClient: 2, minServer: 4 } },
      }),
    ).toEqual([
      "API compatibility levels changed: raise expo.version in apps/mobile/app.json by at least a minor version above 1.0.4.",
      "API compatibility levels changed: raise serverVersion in apps/backend/src/version.ts by at least a minor version above 0.1.5.",
    ]);
  });

  test("counts a major bump as at least a minor bump", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: {
          client: { version: "2.0.0", buildNumber: 6, versionCode: 6 },
          server: "1.0.0",
          apiCompatibility: { level: 4, minClient: 2, minServer: 3 },
        },
      }),
    ).toEqual([]);
  });

  test("rejects levels going down", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: { ...minorBump, apiCompatibility: { level: 3, minClient: 1, minServer: 2 } },
      }),
    ).toEqual([
      "minClientApiCompatibilityLevel can't go down (was 2, now 1).",
      "minServerApiCompatibilityLevel can't go down (was 3, now 2).",
    ]);
  });

  test("rejects skipping a level", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: { ...minorBump, apiCompatibility: { level: 5, minClient: 2, minServer: 3 } },
      }),
    ).toEqual(["apiCompatibilityLevel can only go up by 1 per change (was 3, now 5)."]);
  });

  test("rejects a minimum above the current level", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: { ...minorBump, apiCompatibility: { level: 3, minClient: 4, minServer: 4 } },
      }),
    ).toEqual([
      "minClientApiCompatibilityLevel (4) can't be above apiCompatibilityLevel (3).",
      "minServerApiCompatibilityLevel (4) can't be above apiCompatibilityLevel (3).",
    ]);
  });

  test("only checks the head levels when the base branch has none yet", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base: { ...base, apiCompatibility: null },
        head: { ...bumped, apiCompatibility: { level: 1, minClient: 1, minServer: 1 } },
      }),
    ).toEqual([]);
  });

  test("can read the real level file", async () => {
    const source = await Bun.file(
      new URL("../packages/shared/src/apiCompatibilityLevel.ts", import.meta.url),
    ).text();
    expect(() => parseApiCompatibilityLevels(source)).not.toThrow();
  });

  test("reads the levels from the shared file", () => {
    expect(
      parseApiCompatibilityLevels(
        "export const apiCompatibilityLevel = 12;\nexport const minClientApiCompatibilityLevel = 3;\nexport const minServerApiCompatibilityLevel = 10;\n",
      ),
    ).toEqual({ level: 12, minClient: 3, minServer: 10 });
    expect(() =>
      parseApiCompatibilityLevels(
        "export const apiCompatibilityLevel = 1.5;\nexport const minClientApiCompatibilityLevel = 1;\nexport const minServerApiCompatibilityLevel = 1;\n",
      ),
    ).toThrow();
  });
});

describe("version parsing", () => {
  test("reads the client versions from app.json", () => {
    expect(
      parseClientVersion(
        JSON.stringify({
          expo: { version: "1.2.3", ios: { buildNumber: "7" }, android: { versionCode: 7 } },
        }),
      ),
    ).toEqual({ version: "1.2.3", buildNumber: 7, versionCode: 7 });
  });

  test("rejects an app.json without build numbers", () => {
    expect(() => parseClientVersion(JSON.stringify({ expo: { version: "1.2.3" } }))).toThrow();
  });

  test("reads the server version and rejects non-semver values", () => {
    expect(parseServerVersion('export const serverVersion = "0.2.0";\n')).toBe("0.2.0");
    expect(() => parseServerVersion('export const serverVersion = "beta";\n')).toThrow();
  });
});
