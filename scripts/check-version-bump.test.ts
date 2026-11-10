import { describe, expect, test } from "bun:test";
import {
  findMissingVersionBumps,
  parseClientVersion,
  parseServerVersion,
} from "./check-version-bump.ts";

const base = { client: { version: "1.0.4", buildNumber: 5, versionCode: 5 }, server: "0.1.5" };
const bumped = { client: { version: "1.0.5", buildNumber: 6, versionCode: 6 }, server: "0.1.6" };

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

  test("treats Docker build files and the lockfile as server code", () => {
    for (const file of [
      "Dockerfile",
      "apps/scheduled-jobs/Dockerfile",
      ".dockerignore",
      "apps/scheduled-jobs/.dockerignore",
      "bun.lock",
    ]) {
      expect(findMissingVersionBumps({ changedFiles: [file], base, head: base })).toEqual([
        "Server code changed: raise serverVersion in apps/backend/src/version.ts above 0.1.5.",
      ]);
      expect(
        findMissingVersionBumps({ changedFiles: [file], base, head: { ...base, server: "0.1.6" } }),
      ).toEqual([]);
    }
  });

  test("only matches Docker and lockfile paths exactly", () => {
    expect(
      findMissingVersionBumps({
        changedFiles: ["docs/Dockerfile", "docs/bun.lock", "my.dockerignore"],
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
