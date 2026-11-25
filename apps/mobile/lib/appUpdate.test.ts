import { beforeEach, describe, expect, mock, test } from "bun:test";

const stored = new Map<string, string>();
const platform = { OS: "android", Version: "17.5" };
let playCheck: { status: "available" | "inProgress"; versionCode: number } | { status: "none" } = {
  status: "none",
};
let playStarts = 0;
let playStartResult: "started" | "cancelled" | "failed" = "started";
const opened: string[] = [];

mock.module("react-native-mmkv", () => ({
  createMMKV: () => ({
    getNumber: () => 1,
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => {
      stored.set(key, value);
    },
  }),
}));
mock.module("expo-localization", () => ({ getLocales: () => [{ regionCode: "GB" }] }));
mock.module("react-native", () => ({
  Platform: platform,
  Linking: {
    openURL: async (url: string) => {
      opened.push(url);
      return true;
    },
  },
}));
mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    checkAppUpdate: async () => playCheck,
    startAppUpdate: async () => {
      playStarts += 1;
      return playStartResult;
    },
  },
}));

const { appStoreUpdateFromLookup, findAppUpdate, isNewerVersion, skipAppUpdate } =
  await import("./appUpdate.ts");

beforeEach(() => {
  stored.clear();
  platform.OS = "android";
  playCheck = { status: "none" };
  playStarts = 0;
  playStartResult = "started";
  opened.length = 0;
});

describe("isNewerVersion", () => {
  test.each([
    ["1.54.0", "1.53.2", true],
    ["1.10.0", "1.9.9", true],
    ["2.0", "1.99.99", true],
    ["1.53.2", "1.53.2", false],
    ["1.53", "1.53.0", false],
    ["1.53.1", "1.53.2", false],
    ["1.54.0-beta", "1.53.2", false],
    ["", "1.53.2", false],
  ])("%s is newer than %s: %p", (candidate, installed, expected) => {
    expect(isNewerVersion(candidate, installed)).toBe(expected);
  });
});

describe("appStoreUpdateFromLookup", () => {
  const lookup = (response: unknown) =>
    appStoreUpdateFromLookup({ response, installed: "1.53.2", osVersion: "17.5" });

  test("offers the App Store version when it is newer", () => {
    expect(
      lookup({ results: [{ trackId: 123, version: "1.54.0", minimumOsVersion: "17.0" }] }),
    ).toEqual({ trackId: 123, version: "1.54.0" });
  });

  test("offers nothing when the app is not in the App Store or is up to date", () => {
    expect(lookup({ resultCount: 0, results: [] })).toBeNull();
    expect(lookup({ results: [{ trackId: 123, version: "1.53.2" }] })).toBeNull();
  });

  test("offers nothing the phone's iOS version can't install", () => {
    expect(
      lookup({ results: [{ trackId: 123, version: "1.54.0", minimumOsVersion: "18.0" }] }),
    ).toBeNull();
  });

  test("offers nothing for a response it does not understand", () => {
    expect(lookup("<html>")).toBeNull();
    expect(lookup({ results: [{ version: "9.0.0" }] })).toBeNull();
  });
});

describe("findAppUpdate on Android", () => {
  test("offers nothing when Google Play has no update", async () => {
    expect(await findAppUpdate()).toBeNull();
  });

  test("offers the Play update until the person skips that version", async () => {
    playCheck = { status: "available", versionCode: 120 };
    const update = await findAppUpdate();
    expect(update).toMatchObject({ key: "android:120", latestVersion: null, store: "Google Play" });
    if (!update) throw new Error("expected an update");

    skipAppUpdate(update);
    expect(await findAppUpdate()).toBeNull();

    playCheck = { status: "available", versionCode: 121 };
    expect(await findAppUpdate()).toMatchObject({ key: "android:121" });
  });

  test("offers to resume an update the person already started without starting it", async () => {
    playCheck = { status: "inProgress", versionCode: 120 };
    const update = await findAppUpdate();
    expect(update).toMatchObject({ key: "android:120" });
    expect(playStarts).toBe(0);
    await update?.start();
    expect(playStarts).toBe(1);
  });
});

describe("starting a Play update", () => {
  test.each([
    ["started", true, []],
    ["cancelled", false, []],
    ["failed", true, ["market://details?id=net.openbeacon.app"]],
  ] as const)("when Play reports %s", async (result, expected, listing) => {
    playCheck = { status: "available", versionCode: 120 };
    playStartResult = result;
    const update = await findAppUpdate();
    expect(await update?.start()).toBe(expected);
    expect(opened).toEqual([...listing]);
  });
});

describe("findAppUpdate on iOS", () => {
  test("asks the App Store in the phone's region, never Google Play", async () => {
    platform.OS = "ios";
    playCheck = { status: "available", versionCode: 120 };
    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify({ results: [{ trackId: 7, version: "9.0.0" }] }));
    }) as unknown as typeof fetch;
    const update = await findAppUpdate();
    globalThis.fetch = originalFetch;
    expect(update).toMatchObject({
      key: "ios:9.0.0",
      latestVersion: "9.0.0",
      store: "the App Store",
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("bundleId=net.openbeacon.app&country=gb&");
  });
});
