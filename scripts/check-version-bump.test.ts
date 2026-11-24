import { describe, expect, test } from "bun:test";
import {
  findMissingVersionBumps,
  parseApiCompatibilityLevels,
  parseClientVersion,
  parseOldestSupportedAppVersion,
  parseRootPackage,
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
          "apps/mobile/test/secretLeaks.testUtil.ts",
          "apps/mobile/test/preload.ts",
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
        changedFiles: ["packages/database/src/index.ts"],
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

  test("treats Docker build files and bunfig.toml as server code", () => {
    for (const file of [
      "Dockerfile",
      ".dockerignore",
      "apps/scheduled-jobs/.dockerignore",
      "apps/map-tiles/Dockerfile",
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

  test("requires both versions when the lockfile, a dependency patch, the database schema or the root dependencies change", () => {
    const rootPackage = (catalog: Record<string, string>) =>
      parseRootPackage(JSON.stringify({ name: "openbeacon", workspaces: { catalog } }));
    const changes = [
      { changedFiles: ["bun.lock"], base, head: base },
      { changedFiles: ["packages/database/prisma/schema.prisma"], base, head: base },
      {
        changedFiles: ["patches/@maplibre%2Fmaplibre-react-native@11.5.1.patch"],
        base,
        head: base,
      },
      {
        changedFiles: ["package.json"],
        base: { ...base, rootPackage: rootPackage({ react: "19.2.0" }) },
        head: { ...base, rootPackage: rootPackage({ react: "19.2.1" }) },
      },
      { changedFiles: ["package.json"], base, head: base },
    ];
    for (const change of changes) {
      expect(findMissingVersionBumps(change)).toEqual([
        "Client code changed: raise expo.version in apps/mobile/app.json above 1.0.4.",
        "Client code changed: raise expo.ios.buildNumber in apps/mobile/app.json above 5.",
        "Client code changed: raise expo.android.versionCode in apps/mobile/app.json above 5.",
        "Server code changed: raise serverVersion in apps/backend/src/version.ts above 0.1.5.",
      ]);
      expect(
        findMissingVersionBumps({
          ...change,
          head: { ...bumped, rootPackage: change.head.rootPackage },
        }),
      ).toEqual([]);
    }
  });

  test("ignores a root package.json change that only touches scripts", () => {
    const withScripts = (scripts: Record<string, string>) =>
      parseRootPackage(JSON.stringify({ name: "openbeacon", scripts, overrides: { a: "1" } }));
    expect(
      findMissingVersionBumps({
        changedFiles: ["package.json"],
        base: { ...base, rootPackage: withScripts({ ci: "bun test" }) },
        head: { ...base, rootPackage: withScripts({ ci: "bun test scripts" }) },
      }),
    ).toEqual([]);
  });

  test("requires at least a minor server bump when a migration changes", () => {
    const changedFiles = ["packages/database/prisma/migrations/20261119000000_add/migration.sql"];
    expect(findMissingVersionBumps({ changedFiles, base, head: bumped })).toEqual([
      "Database migration changed: raise serverVersion in apps/backend/src/version.ts by at least a minor version above 0.1.5.",
    ]);
    expect(findMissingVersionBumps({ changedFiles, base, head: base })).toEqual([
      "Database migration changed: raise serverVersion in apps/backend/src/version.ts by at least a minor version above 0.1.5.",
    ]);
    expect(
      findMissingVersionBumps({ changedFiles, base, head: { ...base, server: "0.2.0" } }),
    ).toEqual([]);
  });

  test("reads the root package.json without its scripts", async () => {
    const source = await Bun.file(new URL("../package.json", import.meta.url)).text();
    expect(JSON.parse(parseRootPackage(source))).not.toHaveProperty("scripts");
    expect(JSON.parse(parseRootPackage(source))).toHaveProperty("workspaces");
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

describe("oldest supported app version", () => {
  const serverFile = ["apps/backend/src/version.ts"];
  const newLevel = { level: 4, minClient: 4, minServer: 4 };

  test("allows it unchanged when the minimum is unchanged and the app is bumped", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: ["apps/mobile/app/index.tsx", ...serverFile],
        base: { ...base, oldestSupportedApp: "1.0.0" },
        head: { ...bumped, oldestSupportedApp: "1.0.0" },
      }),
    ).toEqual([]);
  });

  test("rejects it above expo.version", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: serverFile,
        base,
        head: { ...bumped, oldestSupportedApp: "1.2.0" },
      }),
    ).toEqual([
      "oldestSupportedAppVersion (1.2.0) in apps/backend/src/version.ts can't be above expo.version (1.0.5): set it to 1.0.5 or lower.",
    ]);
  });

  test("rejects it going down", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: serverFile,
        base: { ...base, oldestSupportedApp: "1.0.2" },
        head: { ...bumped, oldestSupportedApp: "1.0.1" },
      }),
    ).toEqual([
      "oldestSupportedAppVersion in apps/backend/src/version.ts can't go down (was 1.0.2, now 1.0.1): set it back to 1.0.2 or later.",
    ]);
  });

  test("rejects a change while the client minimum stays the same", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: serverFile,
        base: { ...base, oldestSupportedApp: "1.0.0" },
        head: { ...bumped, oldestSupportedApp: "1.0.3" },
      }),
    ).toEqual([
      "minClientApiCompatibilityLevel didn't change: set oldestSupportedAppVersion in apps/backend/src/version.ts back to 1.0.0.",
    ]);
  });

  test("requires the new app version when the client minimum rises to a brand-new level", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base: { ...base, oldestSupportedApp: "1.0.0" },
        head: { ...minorBump, oldestSupportedApp: "1.0.0", apiCompatibility: newLevel },
      }),
    ).toEqual([
      "minClientApiCompatibilityLevel rose to the new level 4: set oldestSupportedAppVersion in apps/backend/src/version.ts to 1.1.0.",
    ]);
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base,
        head: { ...minorBump, oldestSupportedApp: "1.0.4", apiCompatibility: newLevel },
      }),
    ).toHaveLength(1);
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base: { ...base, oldestSupportedApp: "1.0.0" },
        head: { ...minorBump, oldestSupportedApp: "1.1.0", apiCompatibility: newLevel },
      }),
    ).toEqual([]);
  });

  test("requires it to go up when the client minimum rises to an existing level", () => {
    const head = { ...minorBump, apiCompatibility: { ...levels, minClient: 3 } };
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base: { ...base, oldestSupportedApp: "1.0.0" },
        head: { ...head, oldestSupportedApp: "1.0.0" },
      }),
    ).toEqual([
      "minClientApiCompatibilityLevel rose to 3: set oldestSupportedAppVersion in apps/backend/src/version.ts above 1.0.0, to the first app version on level 3.",
    ]);
    expect(
      findMissingVersionBumps({
        changedFiles: levelFile,
        base: { ...base, oldestSupportedApp: "1.0.0" },
        head: { ...head, oldestSupportedApp: "1.0.3" },
      }),
    ).toEqual([]);
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

  test("reads the oldest supported app version from the real file", async () => {
    const source = await Bun.file(
      new URL("../apps/backend/src/version.ts", import.meta.url),
    ).text();
    expect(parseOldestSupportedAppVersion(source, { required: true })).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("requires HEAD to export a valid oldest supported app version", () => {
    expect(() =>
      parseOldestSupportedAppVersion('export const serverVersion = "0.2.0";\n', {
        required: true,
      }),
    ).toThrow("apps/backend/src/version.ts must export oldestSupportedAppVersion");
    expect(() =>
      parseOldestSupportedAppVersion('export const oldestSupportedAppVersion = "beta";\n', {
        required: true,
      }),
    ).toThrow();
  });

  test("lets an older base branch lack the oldest supported app version", () => {
    expect(
      parseOldestSupportedAppVersion('export const serverVersion = "0.2.0";\n', {
        required: false,
      }),
    ).toBe(undefined);
  });
});
