import { beforeEach, describe, expect, mock, test } from "bun:test";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

const replacements: unknown[] = [];
let createHistoryKeyError: Error | null = null;
let registrationError: Error | null = null;
let deviceActive: boolean | Error = true;
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
    if (registrationError) throw registrationError;
    return { userId: "user-1" };
  },
}));

mock.module("./deviceActivation.ts", () => ({
  isThisDeviceActive: async () => {
    events.push("status");
    if (deviceActive instanceof Error) throw deviceActive;
    return deviceActive;
  },
}));

mock.module("./createHistoryKey.ts", () => ({
  createHistoryKeyIfMissing: async (userId: string) => {
    events.push(`createHistoryKey:${userId}`);
    if (createHistoryKeyError) throw createHistoryKeyError;
    return true;
  },
}));

mock.module("./pendingJoinCode.ts", () => ({
  clearPendingJoinCodes: () => events.push("clearJoinCodes"),
  savePendingJoinCode: ({ code, userId }: { code: string; userId: string }) =>
    events.push(`saveJoinCode:${userId}:${code}`),
}));

const { finishAuthentication } = await import("./finishAuthentication.ts");

describe("finishing authentication", () => {
  beforeEach(() => {
    replacements.length = 0;
    createHistoryKeyError = null;
    registrationError = null;
    deviceActive = true;
    events.length = 0;
  });

  test("a new account creates its history key after the device registers and before leaving", async () => {
    await finishAuthentication({ joinCode: "ABC123", newAccount: true });

    expect(events).toEqual([
      "register",
      "status",
      "clearJoinCodes",
      "createHistoryKey:user-1",
      "navigate",
    ]);
    expect(replacements).toEqual([{ pathname: "/join", params: { code: "ABC123" } }]);
  });

  test("a new account still goes home when creating the history key fails", async () => {
    createHistoryKeyError = new Error("offline");
    await finishAuthentication({ joinCode: undefined, newAccount: true });

    expect(replacements).toEqual(["/"]);
  });

  test("signing in on an active device goes home without creating a history key", async () => {
    await finishAuthentication({ joinCode: undefined });

    expect(events).toEqual(["register", "status", "clearJoinCodes", "navigate"]);
    expect(replacements).toEqual(["/"]);
  });

  test("a Pending device opens setup and never creates a history key", async () => {
    deviceActive = false;
    await finishAuthentication({ joinCode: "ABC123", newAccount: true });

    expect(events).toEqual(["register", "status", "saveJoinCode:user-1:ABC123", "navigate"]);
    expect(replacements).toEqual(["/setup"]);
  });

  test("a Pending device signing in without an invite forgets any invite saved earlier", async () => {
    deviceActive = false;
    await finishAuthentication({ joinCode: undefined });

    expect(events).toEqual(["register", "status", "clearJoinCodes", "navigate"]);
    expect(replacements).toEqual(["/setup"]);
  });

  test("goes home when the device status can't be checked", async () => {
    deviceActive = new Error("offline");
    await finishAuthentication({ joinCode: undefined });

    expect(replacements).toEqual(["/"]);
  });

  test("goes home without a status check when registration fails", async () => {
    registrationError = new Error("offline");
    await finishAuthentication({ joinCode: undefined, newAccount: true });

    expect(events).toEqual(["register", "clearJoinCodes", "navigate"]);
    expect(replacements).toEqual(["/"]);
  });

  test("leaves navigation to the removed-phone handler when this phone was removed", async () => {
    registrationError = new TRPCClientError("This device was removed.", {
      result: {
        error: {
          code: -32600,
          message: "This device was removed.",
          data: { cause: deviceRemovedCause },
        },
      },
    });
    await finishAuthentication({ joinCode: "ABC123", newAccount: true });

    expect(events).toEqual(["register"]);
    expect(replacements).toEqual([]);
  });
});
