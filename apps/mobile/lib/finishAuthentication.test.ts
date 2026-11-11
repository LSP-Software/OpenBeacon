import { beforeEach, describe, expect, mock, test } from "bun:test";

const replacements: unknown[] = [];
const storageValues = new Map<string, number>();
let missingHistoryKey: { userId: string; version: number } | null = null;
let findMissingHistoryKeyError: Error | null = null;
let findMissingHistoryKeyCalls = 0;
let createHistoryKeyError: Error | null = null;
const events: string[] = [];

mock.module("expo-router", () => ({
  router: {
    replace: (target: unknown) => {
      events.push("navigate");
      replacements.push(target);
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => {
    events.push("register");
    return { userId: "user-1" };
  },
}));

mock.module("./createHistoryKey.ts", () => ({
  createHistoryKeyIfMissing: async (userId: string) => {
    events.push(`createHistoryKey:${userId}`);
    if (createHistoryKeyError) throw createHistoryKeyError;
    return true;
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
    createHistoryKeyError = null;
    events.length = 0;
  });

  test("a new account creates its history key after the device registers and before leaving", async () => {
    await finishAuthentication({ joinCode: "ABC123", newAccount: true });

    expect(events).toEqual(["register", "createHistoryKey:user-1", "navigate"]);
  });

  test("a new account still goes home when creating the history key fails", async () => {
    createHistoryKeyError = new Error("offline");
    await finishAuthentication({ joinCode: undefined, newAccount: true });

    expect(replacements).toEqual(["/"]);
  });

  test("signing in to an existing account doesn't create a history key", async () => {
    await finishAuthentication({ joinCode: undefined });

    expect(events).toEqual(["navigate"]);
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

  test("a missing history key with no recorded decline goes to the restore screen", async () => {
    missingHistoryKey = { userId: "user-1", version: 2 };
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual([restoreTarget(2)]);
  });

  test("a decline recorded for the same version goes home", async () => {
    missingHistoryKey = { userId: "user-1", version: 2 };
    storageValues.set("recovery.restoreDeclined.user-1", 2);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });

  test("a decline recorded for a higher version goes home", async () => {
    missingHistoryKey = { userId: "user-1", version: 2 };
    storageValues.set("recovery.restoreDeclined.user-1", 3);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });

  test("a newer missing version than the declined one prompts again", async () => {
    missingHistoryKey = { userId: "user-1", version: 3 };
    storageValues.set("recovery.restoreDeclined.user-1", 2);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual([restoreTarget(3)]);
  });

  test("another account's decline doesn't suppress the prompt", async () => {
    missingHistoryKey = { userId: "user-1", version: 1 };
    storageValues.set("recovery.restoreDeclined.user-2", 1);
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual([restoreTarget(1)]);
  });

  test("falls through to home when the missing key check fails", async () => {
    findMissingHistoryKeyError = new Error("offline");
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });
});
