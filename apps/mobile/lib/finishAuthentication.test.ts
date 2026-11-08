import { beforeEach, describe, expect, mock, test } from "bun:test";

const replacements: unknown[] = [];
const storageValues = new Map<string, number>();
let missingHistoryKey: { userId: string; version: number } | null = null;
let findMissingHistoryKeyError: Error | null = null;
let findMissingHistoryKeyCalls = 0;

mock.module("expo-router", () => ({
  router: {
    replace: (target: unknown) => {
      replacements.push(target);
    },
  },
}));

mock.module("./storage.ts", () => ({
  storage: { getNumber: (key: string) => storageValues.get(key) },
}));

mock.module("./recovery.ts", () => ({
  findMissingHistoryKey: async () => {
    findMissingHistoryKeyCalls += 1;
    if (findMissingHistoryKeyError) throw findMissingHistoryKeyError;
    return missingHistoryKey;
  },
}));

const { finishAuthentication } = await import("./finishAuthentication.ts");

const restoreTarget = (version: number) => ({
  pathname: "/account/recovery-restore",
  params: { afterSignIn: "true", missingVersion: String(version) },
});

describe("finishing authentication", () => {
  beforeEach(() => {
    replacements.length = 0;
    storageValues.clear();
    missingHistoryKey = null;
    findMissingHistoryKeyError = null;
    findMissingHistoryKeyCalls = 0;
  });

  test("a join code goes to the join screen without checking for a missing history key", async () => {
    missingHistoryKey = { userId: "user-1", version: 1 };
    await finishAuthentication({ joinCode: "ABC123" });

    expect(replacements).toEqual([{ pathname: "/join", params: { code: "ABC123" } }]);
    expect(findMissingHistoryKeyCalls).toBe(0);
  });

  test("goes home when no history key is missing", async () => {
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });

  test("a missing history key with no recorded skip goes to the restore screen", async () => {
    missingHistoryKey = { userId: "user-1", version: 2 };
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual([restoreTarget(2)]);
  });

  test("a skip recorded for the same version goes home", async () => {
    missingHistoryKey = { userId: "user-1", version: 2 };
    storageValues.set("recovery.restoreSkipped.user-1", 2);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });

  test("a skip recorded for a higher version goes home", async () => {
    missingHistoryKey = { userId: "user-1", version: 2 };
    storageValues.set("recovery.restoreSkipped.user-1", 3);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });

  test("a newer missing version than the skipped one prompts again", async () => {
    missingHistoryKey = { userId: "user-1", version: 3 };
    storageValues.set("recovery.restoreSkipped.user-1", 2);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual([restoreTarget(3)]);
  });

  test("another account's skip doesn't suppress the prompt", async () => {
    missingHistoryKey = { userId: "user-1", version: 1 };
    storageValues.set("recovery.restoreSkipped.user-2", 1);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual([restoreTarget(1)]);
  });

  test("falls through to home when the missing key check fails", async () => {
    findMissingHistoryKeyError = new Error("offline");
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });
});
