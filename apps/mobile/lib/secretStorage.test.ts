import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { createDeviceLinkSecret, createHistoryKeyPair, encodeBase64 } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";

const stored = new Map<string, string>();
const setCalls: string[] = [];
let writeGate: Promise<void> | null = null;
let readGate: Promise<void> | null = null;

mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    stored.delete(key);
  },
  getItemAsync: async (key: string) => {
    await readGate;
    return stored.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    setCalls.push(key);
    const gate = writeGate;
    await gate;
    stored.set(key, value);
  },
}));

const { SECRET_STORAGE_UNAVAILABLE_MESSAGE, invalidateSecretWrites, secretOwner } =
  await import("./secretStorage.ts");
const { deleteStoredHistoryKeys, getStoredHistoryKey, storeHistoryKey } =
  await import("./historyKeys.ts");
const { readSavedDeviceLink, saveDeviceLink } = await import("./savedDeviceLink.ts");

const historyKeyName = "encryption.history.alex.1";
const hold = () => {
  let release = () => {};
  writeGate = new Promise((resolve) => {
    release = resolve;
  });
  return () => {
    writeGate = null;
    release();
  };
};
const settle = async () => {
  for (let index = 0; index < 50; index++) await Promise.resolve();
};
const wipe = async (userId: string) => {
  await invalidateSecretWrites(userId);
  await tryCatch(deleteStoredHistoryKeys({ userId, upToVersion: 3 }));
};

beforeEach(() => {
  stored.clear();
  setCalls.length = 0;
  writeGate = null;
  readGate = null;
});
afterEach(() => {
  jest.useRealTimers();
});

test("a wipe waits for a History key write in progress and then removes it", async () => {
  const release = hold();
  const storing = tryCatch(
    storeHistoryKey({ privateKey: createHistoryKeyPair().privateKey, userId: "alex", version: 1 }),
  );
  await settle();
  const wiping = wipe("alex");
  release();
  await wiping;

  expect((await storing).error).toBeInstanceOf(Error);
  expect(stored.has(historyKeyName)).toBe(false);
});

test("a write that lands after the wipe gave up waiting deletes itself", async () => {
  jest.useFakeTimers();
  const release = hold();
  const storing = tryCatch(
    storeHistoryKey({ privateKey: createHistoryKeyPair().privateKey, userId: "alex", version: 1 }),
  );
  await settle();
  const wiping = wipe("alex");
  await settle();
  jest.advanceTimersByTime(10_000);
  await settle();
  jest.advanceTimersByTime(10_000);
  await wiping;
  expect((await storing).error?.message).toBe(SECRET_STORAGE_UNAVAILABLE_MESSAGE);

  release();
  await settle();

  expect(stored.has(historyKeyName)).toBe(false);
});

test("a flow that started before a wipe can't save a key afterwards", async () => {
  const owner = secretOwner("alex");
  await wipe("alex");

  const late = await tryCatch(
    storeHistoryKey({
      privateKey: createHistoryKeyPair().privateKey,
      owner,
      userId: "alex",
      version: 1,
    }),
  );

  expect(late.error).toBeInstanceOf(Error);
  expect(setCalls).toEqual([]);
  expect(stored.has(historyKeyName)).toBe(false);
});

test("a wipe doesn't stop the account saving keys again after a new sign-in", async () => {
  await wipe("alex");
  const key = createHistoryKeyPair().privateKey;

  await storeHistoryKey({
    privateKey: key,
    owner: secretOwner("alex"),
    userId: "alex",
    version: 1,
  });

  expect((await getStoredHistoryKey({ userId: "alex", version: 1 }))?.expose()).toEqual(
    key.expose(),
  );
});

test("a wipe of one account leaves another account's write alone", async () => {
  const release = hold();
  const storing = storeHistoryKey({
    privateKey: createHistoryKeyPair().privateKey,
    userId: "sam",
    version: 1,
  });
  await settle();
  const wiping = wipe("alex");
  release();
  await Promise.all([storing, wiping]);

  expect(stored.has("encryption.history.sam.1")).toBe(true);
});

test("a timed-out write can't land after a newer write to the same key", async () => {
  jest.useFakeTimers();
  const release = hold();
  const first = createHistoryKeyPair().privateKey;
  const second = createHistoryKeyPair().privateKey;
  const firstWrite = tryCatch(storeHistoryKey({ privateKey: first, userId: "alex", version: 1 }));
  await settle();
  jest.advanceTimersByTime(10_000);
  expect((await firstWrite).error?.message).toBe(SECRET_STORAGE_UNAVAILABLE_MESSAGE);

  const secondWrite = storeHistoryKey({ privateKey: second, userId: "alex", version: 1 });
  release();
  await secondWrite;

  expect(stored.get(historyKeyName)).toBe(encodeBase64(second.expose()));
});

test("a stalled History key read fails instead of reporting a missing key", async () => {
  jest.useFakeTimers();
  stored.set(historyKeyName, encodeBase64(createHistoryKeyPair().privateKey.expose()));
  readGate = new Promise(() => {});
  const reading = tryCatch(getStoredHistoryKey({ userId: "alex", version: 1 }));
  await settle();
  jest.advanceTimersByTime(10_000);

  const result = await reading;

  expect(result.error?.message).toBe(SECRET_STORAGE_UNAVAILABLE_MESSAGE);
});

test("a wipe while a device link secret is being saved leaves no secret behind", async () => {
  const device = { deviceId: "phone", userId: "alex" };
  const release = hold();
  const saving = tryCatch(
    saveDeviceLink({ ...device, linkId: "link", psk: createDeviceLinkSecret() }),
  );
  await settle();
  const wiping = invalidateSecretWrites("alex");
  release();
  await wiping;

  expect((await saving).error).toBeInstanceOf(Error);
  expect(await readSavedDeviceLink(device)).toBeNull();
});
