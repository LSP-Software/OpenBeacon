import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createHistoryKeyPair,
  getHistoryPublicKey,
  type HistoryPrivateKeyMaterial,
} from "@openbeacon/encryption";

const userId = "user-1";
const storedKeys = new Map<number, HistoryPrivateKeyMaterial>();
const storageValues = new Map<string, string>();
let createError: Error | null = null;
let statusError: Error | null = null;
let serverHistoryKey: { publicKey: string; version: number } | null = null;
let recoveryKey: object | null = null;
let createGate: Promise<void> | null = null;
let creates = 0;

mock.module("./api.ts", () => ({
  trpcClient: {
    accountHistory: {
      create: {
        mutate: async ({ publicKey }: { publicKey: string }) => {
          creates += 1;
          await createGate;
          if (createError) throw createError;
          if (serverHistoryKey) throw new Error("CONFLICT");
          serverHistoryKey = { publicKey, version: 1 };
          return {};
        },
      },
    },
    accountRecovery: {
      status: {
        query: async () => {
          if (statusError) throw statusError;
          return { currentHistoryKey: serverHistoryKey, recoveryKey };
        },
      },
    },
  },
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async (input: { userId: string; version: number }) =>
    input.userId === userId ? (storedKeys.get(input.version) ?? null) : null,
  storeHistoryKey: async (input: { privateKey: HistoryPrivateKeyMaterial; version: number }) => {
    storedKeys.set(input.version, input.privateKey);
  },
  deleteStoredHistoryKeys: async (input: { upToVersion: number }) => {
    for (let version = 1; version <= input.upToVersion; version += 1) storedKeys.delete(version);
  },
}));

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

const { createHistoryKey } = await import("./createHistoryKey.ts");
const { getCurrentHistoryKeyState } = await import("./currentHistoryKey.ts");

const storedPublicKey = () => {
  const stored = storedKeys.get(1);
  return stored ? getHistoryPublicKey(stored) : null;
};

describe("creating the first History key", () => {
  beforeEach(() => {
    storedKeys.clear();
    storageValues.clear();
    createError = null;
    statusError = null;
    serverHistoryKey = null;
    recoveryKey = null;
    createGate = null;
    creates = 0;
  });

  test("two overlapping creates on one phone publish one key and keep it", async () => {
    let release = () => {};
    createGate = new Promise((resolve) => {
      release = resolve;
    });

    const both = Promise.allSettled([createHistoryKey(userId), createHistoryKey(userId)]);
    for (let index = 0; index < 50; index++) await Promise.resolve();
    release();
    await both;

    expect(creates).toBe(1);
    expect(storedPublicKey()).toBe(serverHistoryKey?.publicKey ?? "none");
  });

  test("keeps the key when neither the create nor the status check answers, since the create may have saved it", async () => {
    createError = new Error("Network request failed");
    statusError = new Error("Network request failed");

    await expect(createHistoryKey(userId)).rejects.toThrow("Network request failed");

    expect(storedKeys.has(1)).toBe(true);
  });

  test("deletes that key once the server shows another phone's key won", async () => {
    createError = new Error("CONFLICT");
    statusError = new Error("Network request failed");
    await expect(createHistoryKey(userId)).rejects.toThrow("CONFLICT");
    statusError = null;
    serverHistoryKey = { publicKey: createHistoryKeyPair().publicKey, version: 1 };

    expect(await getCurrentHistoryKeyState(userId)).toEqual({
      status: "onOtherDevice",
      version: 1,
    });
    expect(storedKeys.has(1)).toBe(false);
  });

  test("keeps that key once the server shows the create did save it", async () => {
    createError = new Error("Request timed out");
    statusError = new Error("Network request failed");
    await expect(createHistoryKey(userId)).rejects.toThrow("Request timed out");
    const publicKey = storedPublicKey();
    if (!publicKey) throw new Error("The key was not stored.");
    statusError = null;
    serverHistoryKey = { publicKey, version: 1 };

    expect(await getCurrentHistoryKeyState(userId)).toMatchObject({ status: "held" });
    expect(storedKeys.has(1)).toBe(true);
  });

  test("never deletes a mismatched key that this phone didn't just try to publish", async () => {
    storedKeys.set(1, createHistoryKeyPair().privateKey);
    serverHistoryKey = { publicKey: createHistoryKeyPair().publicKey, version: 1 };

    expect(await getCurrentHistoryKeyState(userId)).toEqual({ status: "mismatch", version: 1 });
    expect(storedKeys.has(1)).toBe(true);
  });

  test("never deletes a published key after an earlier attempt was confirmed", async () => {
    await createHistoryKey(userId);
    serverHistoryKey = { publicKey: createHistoryKeyPair().publicKey, version: 1 };

    expect(await getCurrentHistoryKeyState(userId)).toEqual({ status: "mismatch", version: 1 });
    expect(storedKeys.has(1)).toBe(true);
  });
});
