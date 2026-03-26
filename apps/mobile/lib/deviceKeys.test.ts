import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDeviceKeyPair, encodeBase64 } from "@openbeacon/encryption";

const secureStoreValues = new Map<string, string>();
const storageValues = new Map<string, string>();
let currentUserId = "user-a";

const registerDeviceKeyMock = mock(async () => ({}));

mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    secureStoreValues.delete(key);
  },
  getItemAsync: async (key: string) => secureStoreValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureStoreValues.set(key, value);
  },
}));

mock.module("./api.ts", () => ({
  trpcClient: {
    auth: {
      deviceKeyContext: {
        query: async () => ({
          recipients: [],
          userId: currentUserId,
        }),
      },
      registerDeviceKey: {
        mutate: registerDeviceKeyMock,
      },
    },
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

const importDeviceKeysModule = async () =>
  import(`./deviceKeys.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./deviceKeys.ts")
  >;

describe("device key registration", () => {
  beforeEach(() => {
    secureStoreValues.clear();
    storageValues.clear();
    currentUserId = "user-a";
    registerDeviceKeyMock.mockClear();
  });

  test("stores a separate device context for each authenticated user", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();

    const firstUserDevice = await ensureDeviceKeyRegistration();
    const firstUserDeviceAgain = await ensureDeviceKeyRegistration();

    currentUserId = "user-b";
    const secondUserDevice = await ensureDeviceKeyRegistration();

    currentUserId = "user-a";
    const firstUserDeviceAfterSwitch = await ensureDeviceKeyRegistration();

    expect(firstUserDeviceAgain.deviceId).toBe(firstUserDevice.deviceId);
    expect(firstUserDeviceAfterSwitch.deviceId).toBe(firstUserDevice.deviceId);
    expect(secondUserDevice.deviceId).not.toBe(firstUserDevice.deviceId);
  });

  test("replaces a conflicting legacy device context after an account switch", async () => {
    const legacyDeviceKeyPair = createDeviceKeyPair();

    storageValues.set("encryption.device.id", "legacy-device");
    storageValues.set("encryption.device.publicKey", legacyDeviceKeyPair.publicKey);
    secureStoreValues.set(
      "encryption.device.privateKey",
      encodeBase64(legacyDeviceKeyPair.privateKey.expose()),
    );
    currentUserId = "user-b";
    registerDeviceKeyMock.mockImplementationOnce(async () => {
      throw new Error("This device is already registered to another user.");
    });

    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    const deviceContext = await ensureDeviceKeyRegistration();

    expect(deviceContext.deviceId).not.toBe("legacy-device");
    expect(storageValues.get("encryption.device.id")).toBeUndefined();
    expect(storageValues.get("encryption.device.id.user-b")).toBe(deviceContext.deviceId);
    expect(secureStoreValues.has("encryption.device.privateKey")).toBe(false);
    expect(secureStoreValues.has("encryption.device.privateKey.user-b")).toBe(true);
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(2);
  });
});
