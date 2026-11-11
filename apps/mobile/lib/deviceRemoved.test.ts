import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDeviceKeyPair, encodeBase64 } from "@openbeacon/encryption";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

const secureStoreValues = new Map<string, string>();
const storageValues = new Map<string, string | boolean>();
const navigations: unknown[] = [];
const queueDeletions: Array<{ deviceId: string | undefined; userId: string }> = [];
let signOuts = 0;
let sessionUserId: string | null = "user-a";
let registerError: Error | null = null;
let stalledDelete: string | null = null;
let providersError: Error | null = null;
const providerRequests: unknown[] = [];

mock.module("./pendingJoinCode.ts", () => ({ clearPendingJoinCodes: () => {} }));
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
    if (key === stalledDelete) await new Promise(() => {});
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
      providers: {
        query: async (_input: undefined, options: unknown) => {
          providerRequests.push(options);
          if (providersError) throw providersError;
          return { emailPassword: true, google: false };
        },
      },
      deviceKeyContext: {
        query: async () => {
          if (!sessionUserId) throw new Error("UNAUTHORIZED");
          return { recipients: [], userId: sessionUserId };
        },
      },
      registerDeviceKey: {
        mutate: async () => {
          if (registerError) throw registerError;
          return {};
        },
      },
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

const { ensureDeviceKeyRegistration } = await import("./deviceKeys.ts");
const {
  checkThisPhoneAfterSessionLoss,
  handleDeviceRemoved,
  wipeAfterRemovingThisPhone,
  wipeThisPhone,
} = await import("./deviceRemoved.ts");

const removedError = () =>
  new TRPCClientError("This device was removed.", {
    result: {
      error: {
        code: -32001,
        message: "This device was removed.",
        data: { cause: deviceRemovedCause, code: "UNAUTHORIZED", httpStatus: 401 },
      },
    },
  });

const seedSignedOutPhone = async () => {
  const key = createDeviceKeyPair();
  const device = { deviceId: "device-a" };
  storageValues.set("encryption.device.id.user-a", device.deviceId);
  storageValues.set("encryption.device.publicKey.user-a", key.publicKey);
  secureStoreValues.set(
    "encryption.device.privateKey.user-a",
    encodeBase64(key.privateKey.expose()),
  );
  storageValues.set(`encryption.device.active.${device.deviceId}`, true);
  secureStoreValues.set("encryption.history.user-a.1", "history-1");
  secureStoreValues.set("encryption.history.user-a.3", "history-3");
  secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
  return device;
};

const expectWiped = (deviceId: string) => {
  expect(storageValues.has("encryption.device.id.user-a")).toBe(false);
  expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
  expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(false);
  expect(secureStoreValues.has("encryption.history.user-a.3")).toBe(false);
  expect(storageValues.has(`encryption.device.active.${deviceId}`)).toBe(false);
  expect(secureStoreValues.has(`encryption.deviceLink.user-a.${deviceId}`)).toBe(false);
};

describe("wiping a removed phone", () => {
  beforeEach(() => {
    secureStoreValues.clear();
    storageValues.clear();
    navigations.length = 0;
    queueDeletions.length = 0;
    signOuts = 0;
    sessionUserId = "user-a";
    registerError = null;
    stalledDelete = null;
    providersError = null;
    providerRequests.length = 0;
  });

  test("wipes a signed-in phone using its registration", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    storageValues.set(`encryption.device.active.${device.deviceId}`, true);
    secureStoreValues.set("encryption.history.user-a.3", "history-3");
    secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");

    await wipeThisPhone();

    expectWiped(device.deviceId);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(signOuts).toBe(1);
    sessionUserId = "user-a";
    const replacement = await ensureDeviceKeyRegistration();
    expect(replacement.deviceId).not.toBe(device.deviceId);
    expect(replacement.publicKey).not.toBe(device.publicKey);
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

  test("a wipe stopped part-way keeps the registration, so a later wipe still finds this phone and finishes", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    secureStoreValues.set("encryption.history.user-a.1", "history-1");
    secureStoreValues.set("encryption.history.user-a.3", "history-3");
    secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
    stalledDelete = "encryption.device.privateKey.user-a";

    void wipeThisPhone();
    for (
      let index = 0;
      index < 200 && secureStoreValues.has("encryption.history.user-a.1");
      index++
    )
      await Promise.resolve();
    for (let index = 0; index < 50; index++) await Promise.resolve();

    expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(false);
    expect(storageValues.has("encryption.device.registered")).toBe(true);
    stalledDelete = null;
    queueDeletions.length = 0;

    await handleDeviceRemoved();

    expectWiped(device.deviceId);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(navigations).toEqual(["/device-removed"]);
  });

  test("removing this phone while a removed error is wiping it wipes once and doesn't open the removed screen", async () => {
    const device = await seedSignedOutPhone();
    const fromRemovedError = handleDeviceRemoved();
    const fromRemoval = wipeAfterRemovingThisPhone();
    expect(fromRemoval).toBe(fromRemovedError);
    await fromRemoval;

    expectWiped(device.deviceId);
    expect(signOuts).toBe(1);
    expect(navigations).toEqual([]);
  });

  test("a removed error while removing this phone joins its wipe without opening the removed screen", async () => {
    await seedSignedOutPhone();
    const fromRemoval = wipeAfterRemovingThisPhone();
    const fromRemovedError = handleDeviceRemoved();
    expect(fromRemovedError).toBe(fromRemoval);
    await fromRemovedError;

    expect(signOuts).toBe(1);
    expect(navigations).toEqual([]);
  });

  test("a registration refused as removed leaves the cleanup to the wipe", async () => {
    const device = await seedSignedOutPhone();
    registerError = new TRPCClientError("This device was removed.", {
      result: {
        error: {
          code: -32600,
          message: "This device was removed.",
          data: { cause: deviceRemovedCause },
        },
      },
    });

    await expect(ensureDeviceKeyRegistration()).rejects.toBeInstanceOf(TRPCClientError);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    await wipeThisPhone();

    expectWiped(device.deviceId);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
  });

  test("a phone whose session was lost and which the server reports removed is wiped and shows the removed screen", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    secureStoreValues.set("encryption.history.user-a.3", "history-3");
    secureStoreValues.set(`encryption.deviceLink.user-a.${device.deviceId}`, "saved-link");
    providersError = removedError();

    await checkThisPhoneAfterSessionLoss();

    expect(providerRequests).toEqual([{ context: { handleDeviceErrors: false } }]);
    expectWiped(device.deviceId);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(queueDeletions).toEqual([{ deviceId: device.deviceId, userId: "user-a" }]);
    expect(navigations).toEqual(["/device-removed"]);
  });

  test("a phone whose session was lost but is still in Devices only forgets its registration", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;

    await checkThisPhoneAfterSessionLoss();

    expect(providerRequests).toHaveLength(1);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(signOuts).toBe(0);
    expect(navigations).toEqual([]);
  });

  test("a lost session that can't reach the server forgets the registration without wiping", async () => {
    const device = await ensureDeviceKeyRegistration();
    sessionUserId = null;
    providersError = TRPCClientError.from(new TypeError("Network request failed"));

    await checkThisPhoneAfterSessionLoss();

    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(device.deviceId);
    expect(navigations).toEqual([]);
  });

  test("a lost session without a registration sends nothing", async () => {
    await seedSignedOutPhone();

    await checkThisPhoneAfterSessionLoss();

    expect(providerRequests).toEqual([]);
    expect(signOuts).toBe(0);
  });
});
