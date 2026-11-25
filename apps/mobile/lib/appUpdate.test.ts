import { beforeEach, describe, expect, mock, test } from "bun:test";

const stored = new Map<string, string>();
const platform = { OS: "android" };
let playCheck: { status: "available" | "inProgress"; versionCode: number } | { status: "none" } = {
  status: "none",
};
let playStarts = 0;

mock.module("react-native-mmkv", () => ({
  createMMKV: () => ({
    getNumber: () => 1,
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => {
      stored.set(key, value);
    },
  }),
}));
mock.module("react-native", () => ({ Platform: platform, Linking: { openURL: async () => true } }));
mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    checkAppUpdate: async () => playCheck,
    startAppUpdate: async () => {
      playStarts += 1;
      return true;
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
  test("offers the App Store version when it is newer", () => {
    expect(
      appStoreUpdateFromLookup({ results: [{ trackId: 123, version: "1.54.0" }] }, "1.53.2"),
    ).toEqual({ trackId: 123, version: "1.54.0" });
  });

  test("offers nothing when the app is not in the App Store or is up to date", () => {
    expect(appStoreUpdateFromLookup({ resultCount: 0, results: [] }, "1.53.2")).toBeNull();
    expect(
      appStoreUpdateFromLookup({ results: [{ trackId: 123, version: "1.53.2" }] }, "1.53.2"),
    ).toBeNull();
  });

  test("offers nothing for a response it does not understand", () => {
    expect(appStoreUpdateFromLookup("<html>", "1.53.2")).toBeNull();
    expect(appStoreUpdateFromLookup({ results: [{ version: "9.0.0" }] }, "1.53.2")).toBeNull();
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

  test("resumes an update the person already started instead of asking again", async () => {
    playCheck = { status: "inProgress", versionCode: 120 };
    expect(await findAppUpdate()).toBeNull();
    expect(playStarts).toBe(1);
  });
});

describe("findAppUpdate elsewhere", () => {
  test("never asks Google Play on iOS", async () => {
    platform.OS = "ios";
    playCheck = { status: "available", versionCode: 120 };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ results: [] }))) as unknown as typeof fetch;
    expect(await findAppUpdate()).toBeNull();
    globalThis.fetch = originalFetch;
  });
});
