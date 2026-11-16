import { beforeEach, expect, mock, test } from "bun:test";
import { generateImageKey } from "@openbeacon/encryption";

const values = new Map<string, string>();
let writeGate: Promise<void> | null = null;
mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    values.delete(key);
  },
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    await writeGate;
    values.set(key, value);
  },
}));

const { deleteOwnImageKey, ownImageKeyOwner, readOwnImageKey, storeOwnImageKey } =
  await import("./ownImageKey.ts");

const fileName = "0b6f7d1e-3c2a-4b8e-9f10-2a3b4c5d6e7f";

beforeEach(() => {
  values.clear();
  writeGate = null;
});

test("reads back the picture key only for the picture it belongs to", async () => {
  const imageKey = generateImageKey();
  await storeOwnImageKey({ fileName, imageKey, userId: "user-a" });

  expect((await readOwnImageKey({ fileName, userId: "user-a" }))?.expose()).toEqual(
    imageKey.expose(),
  );
  expect(await readOwnImageKey({ fileName: crypto.randomUUID(), userId: "user-a" })).toBeNull();
  expect(await readOwnImageKey({ fileName, userId: "user-b" })).toBeNull();
});

test("a newer picture replaces the older key", async () => {
  await storeOwnImageKey({ fileName, imageKey: generateImageKey(), userId: "user-a" });
  const newer = crypto.randomUUID();
  await storeOwnImageKey({ fileName: newer, imageKey: generateImageKey(), userId: "user-a" });

  expect(await readOwnImageKey({ fileName, userId: "user-a" })).toBeNull();
  expect(await readOwnImageKey({ fileName: newer, userId: "user-a" })).not.toBeNull();
});

test("forgets the key when deleted", async () => {
  await storeOwnImageKey({ fileName, imageKey: generateImageKey(), userId: "user-a" });
  await deleteOwnImageKey("user-a");

  expect(await readOwnImageKey({ fileName, userId: "user-a" })).toBeNull();
});

test("ignores a stored value it can't read", async () => {
  values.set("encryption.profileImage.user-a", "not json");

  expect(await readOwnImageKey({ fileName, userId: "user-a" })).toBeNull();
});

test("a key opened before sign-out isn't written back afterwards", async () => {
  const owner = ownImageKeyOwner("user-a");
  await deleteOwnImageKey("user-a");

  await expect(
    storeOwnImageKey({ fileName, imageKey: generateImageKey(), owner, userId: "user-a" }),
  ).rejects.toThrow();
  expect(await readOwnImageKey({ fileName, userId: "user-a" })).toBeNull();
});

test("a write still in flight when the key is deleted doesn't survive", async () => {
  let release = () => {};
  writeGate = new Promise((resolve) => {
    release = resolve;
  });
  const write = storeOwnImageKey({ fileName, imageKey: generateImageKey(), userId: "user-a" });
  const deleted = deleteOwnImageKey("user-a");
  release();

  await expect(write).rejects.toThrow();
  await deleted;
  expect(values.size).toBe(0);
});

test("keeps keys written after signing back in", async () => {
  await deleteOwnImageKey("user-a");
  await storeOwnImageKey({ fileName, imageKey: generateImageKey(), userId: "user-a" });

  expect(await readOwnImageKey({ fileName, userId: "user-a" })).not.toBeNull();
});
