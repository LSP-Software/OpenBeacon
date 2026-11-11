import { beforeEach, describe, expect, mock, test } from "bun:test";

const secureStoreValues = new Map<string, string>();
const storageValues = new Map<string, string | boolean>();
const navigations: unknown[] = [];
const queueDeletions: Array<{ deviceId: string | undefined; userId: string }> = [];
let signOuts = 0;
let sessionUserId: string | null = "user-a";

mock.module("expo-router", () => ({
  router: {
    replace: (target: unknown) => {
      navigations.push(target);
    },
  },
}));

mock.module("expo-device", () => ({ modelName: "Pixel 8" }));

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

mock.module("./storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => storageValues.get(key) === true,
    getString: (key: string) => {
      const value = storageValues.get(key);
      return typeof value === "string" ? value : undefined;
    },
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string | boolean) => {
      storageValues.set(key, value);
    },
  },
}));

mock.module("./api.ts", () => ({
  queryClient: {
    cancelQueries: async () => {},
    clear: () => {},
    getQueryData: () => ({ currentHistoryKey: { version: 3 } }),
  },
  trpc: { accountRecovery: { status: { queryKey: () => [["accountRecovery", "status"]] } } },
  trpcClient: {
    auth: {
      deviceKeyContext: {
        query: async () => {
          if (!sessionUserId) throw new Error("UNAUTHORIZED");
          return { recipients: [], userId: sessionUserId };
        },
      },
      registerDeviceKey: { mutate: async () => ({}) },
    },
  },
}));

mock.module("./auth-client.ts", () => ({
  authClient: {
    signOut: async () => {
      signOuts += 1;
      return { error: null };
    },
  },
}));

mock.module("./tracking.ts", () => ({
  deleteQueuedTrackingPoints: async (input: { deviceId: string | undefined; userId: string }) => {
    queueDeletions.push(input);
  },
  revokeTrackingAccess: async () => {},
}));

mock.module("./groupColor.ts", () => ({ clearGroupColors: () => {} }));
mock.module("./trackingKeyCheck.ts", () => ({ clearTrackingKeyCheck: () => {} }));
mock.module("./trackingUploadTime.ts", () => ({ clearTrackingUploadTimes: () => {} }));

const { ensureDeviceKeyRegistration, getOrCreateDeviceKeyContext } =
  await import("./deviceKeys.ts");
const { handleDeviceRemoved, wipeThisPhone } = await import("./deviceRemoved.ts");

const seedSignedOutPhone = async () => {
  const device = await getOrCreateDeviceKeyContext("user-a");
  storageValues.set(`encryption.device.active.${device.deviceId}`, true);
  secureStoreValues.set("encryption.history.user-a.1", "history-1");
  secureStoreValues.set("encryption.history.user-a.3", "history-3");
  return device;
};

const expectWiped = (deviceId: string) => {
  expect(storageValues.has("encryption.device.id.user-a")).toBe(false);
  expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
  expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(false);
  expect(secureStoreValues.has("encryption.history.user-a.3")).toBe(false);
  expect(storageValues.has(`encryption.device.active.${deviceId}`)).toBe(false);
};

describe("wiping a removed phone", () => {
  beforeEach(() => {
    secureStoreValues.clear();
    storageValues.clear();
    navigations.length = 0;
    queueDeletions.length = 0;
    signOuts = 0;
    sessionUserId = "user-a";
  });

  test("wipes a signed-in phone using its registration", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    storageValues.set(`encryption.device.active.${device.deviceId}`, true);
    secureStoreValues.set("encryption.history.user-a.3", "history-3");

    await wipeThisPhone();

    expectWiped(device.deviceId);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(signOuts).toBe(1);
  });

  test("wipes a phone that signed out normally, using the signed-in account", async () => {
    const device = await seedSignedOutPhone();

    await wipeThisPhone();

    expectWiped(device.deviceId);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(signOuts).toBe(1);
  });

  test("still signs out when the account can't be found", async () => {
    const device = await seedSignedOutPhone();
    sessionUserId = null;

    await wipeThisPhone();

    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    expect(queueDeletions).toEqual([]);
    expect(signOuts).toBe(1);
  });

  test("several removed errors at once wipe once and open the removed screen once", async () => {
    const device = await seedSignedOutPhone();
    const first = handleDeviceRemoved();
    const second = handleDeviceRemoved();
    expect(second).toBe(first);
    await first;

    expectWiped(device.deviceId);
    expect(signOuts).toBe(1);
    expect(navigations).toEqual(["/device-removed"]);
  });
});
