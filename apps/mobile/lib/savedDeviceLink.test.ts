import { beforeEach, expect, mock, test } from "bun:test";
import { createDeviceLinkSecret } from "@openbeacon/encryption";
import { expectNoSecretsIn } from "../test/secretLeaks.testUtil.ts";

const secureStoreValues = new Map<string, string>();
const secureStoreOptions: unknown[] = [];
const mmkvWrites: unknown[] = [];

mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: async (key: string) => {
    secureStoreValues.delete(key);
  },
  getItemAsync: async (key: string) => secureStoreValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string, options: unknown) => {
    secureStoreOptions.push(options);
    secureStoreValues.set(key, value);
  },
}));

mock.module("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: () => undefined,
    remove: () => {},
    set: (key: string, value: unknown) => {
      mmkvWrites.push([key, value]);
    },
  }),
}));

const { deleteSavedDeviceLink, readSavedDeviceLink, saveDeviceLink } =
  await import("./savedDeviceLink.ts");

const phone = { deviceId: "device-new", userId: "user-1" };

beforeEach(() => {
  secureStoreValues.clear();
  secureStoreOptions.length = 0;
  mmkvWrites.length = 0;
});

test("keeps the link only in this-device-only SecureStore, scoped to the account and phone", async () => {
  const psk = createDeviceLinkSecret();

  await saveDeviceLink({ ...phone, linkId: "link-1", psk });

  expect([...secureStoreValues.keys()]).toEqual(["encryption.deviceLink.user-1.device-new"]);
  expect(secureStoreOptions).toEqual([{ keychainAccessible: "when-unlocked-this-device-only" }]);
  expect(await readSavedDeviceLink(phone)).toEqual({ linkId: "link-1", psk });
  expect(await readSavedDeviceLink({ ...phone, userId: "user-2" })).toBeNull();
  expect(await readSavedDeviceLink({ ...phone, deviceId: "device-other" })).toBeNull();
  expect(mmkvWrites).toEqual([]);
  expectNoSecretsIn(JSON.stringify(mmkvWrites), { secrets: [psk], phrases: [] });
});

test("a new code replaces the saved one and deleting forgets it", async () => {
  const replacement = createDeviceLinkSecret();
  await saveDeviceLink({ ...phone, linkId: "link-1", psk: createDeviceLinkSecret() });
  await saveDeviceLink({ ...phone, linkId: "link-2", psk: replacement });

  expect(await readSavedDeviceLink(phone)).toEqual({ linkId: "link-2", psk: replacement });

  await deleteSavedDeviceLink(phone);
  expect(await readSavedDeviceLink(phone)).toBeNull();
});

test("an unreadable saved link counts as none", async () => {
  for (const stored of ["not json", "null", '{"linkId":1,"psk":"AA=="}']) {
    secureStoreValues.set("encryption.deviceLink.user-1.device-new", stored);
    expect(await readSavedDeviceLink(phone)).toBeNull();
  }
});
