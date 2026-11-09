import { expect, mock, test } from "bun:test";
import { createHistoryKeyPair, encodeBase64 } from "@openbeacon/encryption";

const secureStoreValues = new Map<string, string>();
const secureStoreOptions: unknown[] = [];

mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    secureStoreValues.delete(key);
  },
  getItemAsync: async (key: string, options: unknown) => {
    secureStoreOptions.push(options);
    return secureStoreValues.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string, options: unknown) => {
    secureStoreOptions.push(options);
    secureStoreValues.set(key, value);
  },
}));

const { getStoredHistoryKey, storeHistoryKey } = await import("./historyKeys.ts");

test("stores each history key version per user in this-device-only SecureStore", async () => {
  const v1 = createHistoryKeyPair();
  const v2 = createHistoryKeyPair();

  await storeHistoryKey({ privateKey: v1.privateKey, userId: "user-1", version: 1 });
  await storeHistoryKey({ privateKey: v2.privateKey, userId: "user-1", version: 2 });

  expect([...secureStoreValues.keys()]).toEqual([
    "encryption.history.user-1.1",
    "encryption.history.user-1.2",
  ]);
  expect(secureStoreValues.get("encryption.history.user-1.1")).toBe(
    encodeBase64(v1.privateKey.expose()),
  );
  expect((await getStoredHistoryKey({ userId: "user-1", version: 1 }))?.expose()).toEqual(
    v1.privateKey.expose(),
  );
  expect((await getStoredHistoryKey({ userId: "user-1", version: 2 }))?.expose()).toEqual(
    v2.privateKey.expose(),
  );
  expect(await getStoredHistoryKey({ userId: "user-1", version: 3 })).toBeNull();
  expect(await getStoredHistoryKey({ userId: "user-2", version: 1 })).toBeNull();
  expect(new Set(secureStoreOptions.map((options) => JSON.stringify(options)))).toEqual(
    new Set([JSON.stringify({ keychainAccessible: "when-unlocked-this-device-only" })]),
  );
});
