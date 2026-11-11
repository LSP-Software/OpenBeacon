import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { createDeviceKeyPair, encodeBase64 } from "@openbeacon/encryption";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const secureStoreValues = new Map<string, string>();
const storageValues = new Map<string, string>();
let currentUserId = "user-a";
let secureStoreSetError: Error | null = null;
let secureStoreReadGate: Promise<void> | null = null;
let onSecureStoreRead: (() => void) | null = null;
let secureStoreWriteGate: Promise<void> | null = null;
let onSecureStoreWrite: (() => void) | null = null;
let ownerQueryGate: Promise<void> | null = null;
let onOwnerQuery: (() => void) | null = null;
let ownerQueries = 0;

const registerDeviceKeyMock = mock(
  async (_input: { expectedUserId: string }): Promise<{ sessionLinked?: boolean }> => ({}),
);
const sessionChallengeMock = mock(async (_input: { deviceId: string }) => ({
  linked: true as const,
}));
const deleteItemAsyncMock = mock(async (key: string) => {
  secureStoreValues.delete(key);
});
const setItemAsyncMock = mock(async (key: string, value: string) => {
  if (secureStoreSetError) {
    throw secureStoreSetError;
  }

  onSecureStoreWrite?.();
  await secureStoreWriteGate;
  secureStoreValues.set(key, value);
});

mock.module("react-native", () => createReactNativeTestModule({ platformOS: "android" }));

mock.module("expo-device", () => ({ modelName: "Pixel 8" }));

mock.module("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  deleteItemAsync: deleteItemAsyncMock,
  getItemAsync: async (key: string) => {
    onSecureStoreRead?.();
    await secureStoreReadGate;
    return secureStoreValues.get(key) ?? null;
  },
  setItemAsync: setItemAsyncMock,
}));

mock.module("./api.ts", () => ({
  queryClient: {
    setQueryData: () => {},
  },
  trpc: {
    maps: {
      forceRefreshSignedPmtilesUrl: {
        mutationOptions: () => ({}),
      },
      getSignedPmtilesUrl: {
        queryKey: () => [["maps", "getSignedPmtilesUrl"]],
        queryOptions: () => ({}),
      },
    },
  },
  trpcClient: {
    device: {
      linkSession: { mutate: async () => ({ linked: true }) },
      sessionChallenge: { mutate: sessionChallengeMock },
    },
    auth: {
      deviceKeyContext: {
        query: async () => {
          ownerQueries += 1;
          onOwnerQuery?.();
          await ownerQueryGate;
          return { recipients: [], userId: currentUserId };
        },
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
    secureStoreSetError = null;
    secureStoreReadGate = null;
    onSecureStoreRead = null;
    secureStoreWriteGate = null;
    onSecureStoreWrite = null;
    ownerQueryGate = null;
    onOwnerQuery = null;
    ownerQueries = 0;
    deleteItemAsyncMock.mockClear();
    registerDeviceKeyMock.mockReset();
    registerDeviceKeyMock.mockImplementation(async () => ({}));
    sessionChallengeMock.mockReset();
    sessionChallengeMock.mockImplementation(async () => ({ linked: true as const }));
    setItemAsyncMock.mockClear();
  });

  test("stores a separate device context for each authenticated user", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();

    const firstUserDevice = await ensureDeviceKeyRegistration();
    const firstUserDeviceAgain = await ensureDeviceKeyRegistration();

    currentUserId = "user-b";
    const secondUserDevice = await ensureDeviceKeyRegistration({ checkOwner: true });

    currentUserId = "user-a";
    const firstUserDeviceAfterSwitch = await ensureDeviceKeyRegistration({ checkOwner: true });

    expect(firstUserDeviceAgain.deviceId).toBe(firstUserDevice.deviceId);
    expect(firstUserDeviceAfterSwitch.deviceId).toBe(firstUserDevice.deviceId);
    expect(secondUserDevice.deviceId).not.toBe(firstUserDevice.deviceId);
  });

  test("registers once, then answers without any requests", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();

    const first = await ensureDeviceKeyRegistration();
    const later = await Promise.all([ensureDeviceKeyRegistration(), ensureDeviceKeyRegistration()]);

    expect(later.map(({ deviceId }) => deviceId)).toEqual([first.deviceId, first.deviceId]);
    expect(ownerQueries).toBe(1);
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(1);
  });

  test("a new process reuses the stored registration without any requests", async () => {
    const first = await (await importDeviceKeysModule()).ensureDeviceKeyRegistration();
    const { ensureDeviceKeyRegistration, getRegisteredDeviceKey } = await importDeviceKeysModule();

    expect((await getRegisteredDeviceKey())?.userId).toBe("user-a");
    expect((await ensureDeviceKeyRegistration()).deviceId).toBe(first.deviceId);
    expect(ownerQueries).toBe(1);
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(1);
  });

  test("checking the owner confirms the account without registering again", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    await ensureDeviceKeyRegistration();

    await ensureDeviceKeyRegistration({ checkOwner: true });

    expect(ownerQueries).toBe(2);
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(1);
  });

  test("checking the owner of a leftover registration doesn't link the session", async () => {
    await (await importDeviceKeysModule()).ensureDeviceKeyRegistration();
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();

    await ensureDeviceKeyRegistration({ checkOwner: true });

    expect(ownerQueries).toBe(2);
    expect(sessionChallengeMock).not.toHaveBeenCalled();
  });

  test("confirming identity over a leftover registration links the new session to this phone", async () => {
    const device = await (await importDeviceKeysModule()).ensureDeviceKeyRegistration();
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();

    await ensureDeviceKeyRegistration({ linkSession: true });

    expect(sessionChallengeMock).toHaveBeenCalledWith({ deviceId: device.deviceId });
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(1);
  });

  test("a failed link over a leftover registration fails the identity confirmation", async () => {
    await (await importDeviceKeysModule()).ensureDeviceKeyRegistration();
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    sessionChallengeMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });

    await expect(ensureDeviceKeyRegistration({ linkSession: true })).rejects.toThrow("offline");
  });

  test("registers again after a cancel or a forget", async () => {
    const {
      cancelDeviceKeyRegistrations,
      ensureDeviceKeyRegistration,
      forgetDeviceKeyRegistration,
    } = await importDeviceKeysModule();
    await ensureDeviceKeyRegistration();

    cancelDeviceKeyRegistrations();
    await ensureDeviceKeyRegistration();
    forgetDeviceKeyRegistration();
    await ensureDeviceKeyRegistration();

    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(3);
  });

  test("a failed registration isn't remembered", async () => {
    registerDeviceKeyMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    const { ensureDeviceKeyRegistration, getRegisteredDeviceKey } = await importDeviceKeysModule();

    await expect(ensureDeviceKeyRegistration()).rejects.toThrow("offline");
    expect(await getRegisteredDeviceKey()).toBeNull();
    await ensureDeviceKeyRegistration();

    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(2);
  });

  test("ignores a registration stored for another server or another key", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    const device = await ensureDeviceKeyRegistration();
    const stored = storageValues.get("encryption.device.registered");
    if (!stored) throw new Error("Registration was not stored.");
    const [server] = JSON.parse(stored) as string[];

    storageValues.set(
      "encryption.device.registered",
      JSON.stringify(["https://other.example", "user-a", device.deviceId, device.publicKey]),
    );
    await (await importDeviceKeysModule()).ensureDeviceKeyRegistration();
    storageValues.set(
      "encryption.device.registered",
      JSON.stringify([server, "user-a", device.deviceId, createDeviceKeyPair().publicKey]),
    );
    await (await importDeviceKeysModule()).ensureDeviceKeyRegistration();

    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(3);
  });

  test("a different account found while checking the owner drops the old registration", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    await ensureDeviceKeyRegistration();
    currentUserId = "user-b";
    registerDeviceKeyMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });

    await expect(ensureDeviceKeyRegistration({ checkOwner: true })).rejects.toThrow("offline");

    expect((await ensureDeviceKeyRegistration()).userId).toBe("user-b");
  });

  test("a session change cannot register or delete the original account's key", async () => {
    const key = createDeviceKeyPair();
    storageValues.set("encryption.device.id.user-a", "device-a");
    storageValues.set("encryption.device.publicKey.user-a", key.publicKey);
    const privateKey = encodeBase64(key.privateKey.expose());
    secureStoreValues.set("encryption.device.privateKey.user-a", privateKey);
    let release = () => {};
    let started = false;
    secureStoreReadGate = new Promise((resolve) => {
      release = resolve;
    });
    onSecureStoreRead = () => {
      started = true;
    };
    registerDeviceKeyMock.mockImplementation(async ({ expectedUserId }) => {
      if (expectedUserId !== currentUserId) throw new Error("The active account has changed.");
      return {};
    });
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    const registration = ensureDeviceKeyRegistration();
    for (let index = 0; index < 200 && !started; index++) await Promise.resolve();
    expect(started).toBe(true);
    currentUserId = "user-b";
    release();
    await expect(registration).rejects.toThrow("The active account has changed.");
    expect(registerDeviceKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUserId: "user-a",
        deviceId: "device-a",
        platform: "android",
        model: "Pixel 8",
      }),
    );
    expect(secureStoreValues.get("encryption.device.privateKey.user-a")).toBe(privateKey);
    expect(storageValues.get("encryption.device.id.user-a")).toBe("device-a");
    expect(deleteItemAsyncMock).not.toHaveBeenCalled();
  });

  test("leaves registration capacity after ten simultaneous group checks", async () => {
    registerDeviceKeyMock.mockImplementation(async () => {
      if (registerDeviceKeyMock.mock.calls.length > 10) throw new Error("Too many requests");
      return {};
    });
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    await Promise.all(Array.from({ length: 10 }, () => ensureDeviceKeyRegistration()));
    await expect(ensureDeviceKeyRegistration()).resolves.toBeDefined();
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(1);
  });

  test("concurrent initialization creates one device identity", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    const contexts = await Promise.all(
      Array.from({ length: 5 }, () => ensureDeviceKeyRegistration()),
    );
    expect(new Set(contexts.map((context) => context.deviceId)).size).toBe(1);
    expect(setItemAsyncMock).toHaveBeenCalledTimes(1);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(contexts[0]?.deviceId);
  });

  test("retains local key material when the server reports an ownership conflict", async () => {
    const legacyDeviceKeyPair = createDeviceKeyPair();

    storageValues.set("encryption.device.id", "legacy-device");
    storageValues.set("encryption.device.publicKey", legacyDeviceKeyPair.publicKey);
    secureStoreValues.set(
      "encryption.device.privateKey",
      encodeBase64(legacyDeviceKeyPair.privateKey.expose()),
    );
    currentUserId = "user-b";
    registerDeviceKeyMock.mockImplementation(async () => {
      throw new Error("This device is already registered to another user.");
    });

    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    await expect(ensureDeviceKeyRegistration()).rejects.toThrow(
      "This device is already registered to another user.",
    );

    expect(storageValues.get("encryption.device.id")).toBeUndefined();
    expect(storageValues.get("encryption.device.publicKey")).toBeUndefined();
    expect(storageValues.get("encryption.device.id.user-b")).toBe("legacy-device");
    expect(storageValues.get("encryption.device.publicKey.user-b")).toBe(
      legacyDeviceKeyPair.publicKey,
    );
    expect(secureStoreValues.has("encryption.device.privateKey")).toBe(false);
    expect(secureStoreValues.has("encryption.device.privateKey.user-b")).toBe(true);
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(1);
  });

  test("a cancelled registration cannot block or clear a later registration for the same account", async () => {
    const { cancelDeviceKeyRegistrations, ensureDeviceKeyRegistration } =
      await importDeviceKeysModule();
    const original = await ensureDeviceKeyRegistration();
    cancelDeviceKeyRegistrations();
    registerDeviceKeyMock.mockClear();
    const privateKey = secureStoreValues.get("encryption.device.privateKey.user-a");
    let rejectOld: (error: Error) => void = () => {};
    let releaseNew: () => void = () => {};
    registerDeviceKeyMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    registerDeviceKeyMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseNew = () => resolve({});
        }),
    );
    const old = ensureDeviceKeyRegistration();
    const oldResult = old.catch((error: unknown) => error);
    for (let index = 0; index < 200 && registerDeviceKeyMock.mock.calls.length < 1; index++)
      await Promise.resolve();
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(1);
    cancelDeviceKeyRegistrations();
    const current = ensureDeviceKeyRegistration();
    for (let index = 0; index < 200 && registerDeviceKeyMock.mock.calls.length < 2; index++)
      await Promise.resolve();
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(2);
    rejectOld(new Error("This device is already registered to another user."));
    expect(await oldResult).toBeInstanceOf(Error);
    const shared = ensureDeviceKeyRegistration();
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(registerDeviceKeyMock).toHaveBeenCalledTimes(2);
    releaseNew();
    expect((await current).deviceId).toBe(original.deviceId);
    expect((await shared).deviceId).toBe(original.deviceId);
    expect(storageValues.get("encryption.device.id.user-a")).toBe(original.deviceId);
    expect(secureStoreValues.get("encryption.device.privateKey.user-a")).toBe(privateKey);
  });

  test("a cancelled owner lookup cannot begin registration under a later session", async () => {
    const { cancelDeviceKeyRegistrations, ensureDeviceKeyRegistration } =
      await importDeviceKeysModule();
    let release = () => {};
    let started = false;
    ownerQueryGate = new Promise((resolve) => {
      release = resolve;
    });
    onOwnerQuery = () => {
      started = true;
    };
    const old = ensureDeviceKeyRegistration();
    for (let index = 0; index < 100 && !started; index++) await Promise.resolve();
    expect(started).toBe(true);
    cancelDeviceKeyRegistrations();
    currentUserId = "user-b";
    release();
    await expect(old).rejects.toThrow("Device registration cancelled.");
    expect(registerDeviceKeyMock).not.toHaveBeenCalled();
  });

  test("a stalled secure-store read times out without replacing the existing key", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    jest.useFakeTimers();
    try {
      const key = createDeviceKeyPair();
      storageValues.set("encryption.device.id.user-a", "device-a");
      storageValues.set("encryption.device.publicKey.user-a", key.publicKey);
      const privateKey = encodeBase64(key.privateKey.expose());
      secureStoreValues.set("encryption.device.privateKey.user-a", privateKey);
      let release = () => {};
      let started = false;
      secureStoreReadGate = new Promise((resolve) => {
        release = resolve;
      });
      onSecureStoreRead = () => {
        started = true;
      };
      const attempt = ensureDeviceKeyRegistration();
      const failure = attempt.catch((error: unknown) => error);
      for (let index = 0; index < 200 && !started; index++) await Promise.resolve();
      expect(started).toBe(true);
      jest.advanceTimersByTime(10_000);
      expect(await failure).toEqual(new Error("Device key storage is unavailable."));
      expect(secureStoreValues.get("encryption.device.privateKey.user-a")).toBe(privateKey);
      expect(deleteItemAsyncMock).not.toHaveBeenCalled();
      secureStoreReadGate = null;
      release();
      for (let index = 0; index < 100; index++) await Promise.resolve();
      expect((await ensureDeviceKeyRegistration()).deviceId).toBe("device-a");
      expect(secureStoreValues.get("encryption.device.privateKey.user-a")).toBe(privateKey);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a stalled secure-store write is not replaced by a concurrent identity", async () => {
    const { cancelDeviceKeyRegistrations, ensureDeviceKeyRegistration } =
      await importDeviceKeysModule();
    jest.useFakeTimers();
    try {
      let release = () => {};
      let started = false;
      secureStoreWriteGate = new Promise((resolve) => {
        release = resolve;
      });
      onSecureStoreWrite = () => {
        started = true;
      };
      const first = ensureDeviceKeyRegistration();
      const firstFailure = first.catch((error: unknown) => error);
      for (let index = 0; index < 200 && !started; index++) await Promise.resolve();
      expect(started).toBe(true);
      const deviceId = storageValues.get("encryption.device.id.user-a");
      if (!deviceId) throw new Error("Device ID was not persisted.");
      jest.advanceTimersByTime(10_000);
      expect(await firstFailure).toEqual(new Error("Device key storage is unavailable."));
      cancelDeviceKeyRegistrations();
      const second = ensureDeviceKeyRegistration();
      const secondFailure = second.catch((error: unknown) => error);
      for (let index = 0; index < 100; index++) await Promise.resolve();
      jest.advanceTimersByTime(10_000);
      expect(await secondFailure).toEqual(new Error("Device key storage is unavailable."));
      expect(setItemAsyncMock).toHaveBeenCalledTimes(1);
      expect(storageValues.get("encryption.device.id.user-a")).toBe(deviceId);
      secureStoreWriteGate = null;
      release();
      for (let index = 0; index < 100; index++) await Promise.resolve();
      expect((await ensureDeviceKeyRegistration()).deviceId).toBe(deviceId);
      expect(setItemAsyncMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("rolls back scoped storage when secure store persistence fails", async () => {
    secureStoreSetError = new Error("secure store failed");

    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();

    await expect(ensureDeviceKeyRegistration()).rejects.toThrow("secure store failed");
    expect(storageValues.get("encryption.device.id.user-a")).toBeUndefined();
    expect(storageValues.get("encryption.device.publicKey.user-a")).toBeUndefined();
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(false);
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(
      "encryption.device.privateKey.user-a",
      expect.any(Object),
    );
  });

  test("a phone refused because it was removed keeps its keys for the wipe to find", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    const removed = await ensureDeviceKeyRegistration();
    secureStoreValues.set("encryption.history.user-a.1", "history-key-1");
    registerDeviceKeyMock.mockImplementationOnce(async () => {
      throw new TRPCClientError("This device was removed.", {
        result: {
          error: {
            code: -32600,
            message: "This device was removed.",
            data: { cause: deviceRemovedCause },
          },
        },
      });
    });

    const { ensureDeviceKeyRegistration: registerAfterRestart } = await importDeviceKeysModule();
    storageValues.delete("encryption.device.registered");
    await expect(registerAfterRestart()).rejects.toBeInstanceOf(TRPCClientError);

    expect(storageValues.get("encryption.device.id.user-a")).toBe(removed.deviceId);
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(true);
    expect(deleteItemAsyncMock).not.toHaveBeenCalled();
  });

  test("a registration that fails for another reason keeps this phone's keys", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    secureStoreValues.set("encryption.history.user-a.1", "history-key-1");
    registerDeviceKeyMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });

    await expect(ensureDeviceKeyRegistration()).rejects.toThrow("offline");

    const deviceId = storageValues.get("encryption.device.id.user-a");
    if (!deviceId) throw new Error("The device id was not kept.");
    expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(true);
    expect((await ensureDeviceKeyRegistration()).deviceId).toBe(deviceId);
  });

  test("a phone that was already registered proves its key before the registration is kept", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    registerDeviceKeyMock.mockImplementation(async () => ({ sessionLinked: false }));

    const device = await ensureDeviceKeyRegistration();

    expect(sessionChallengeMock).toHaveBeenCalledTimes(1);
    expect(sessionChallengeMock).toHaveBeenCalledWith({ deviceId: device.deviceId });
    expect(storageValues.has("encryption.device.registered")).toBe(true);
  });

  test("a failed proof keeps this phone's keys and isn't remembered", async () => {
    const { ensureDeviceKeyRegistration } = await importDeviceKeysModule();
    secureStoreValues.set("encryption.history.user-a.1", "history-key-1");
    registerDeviceKeyMock.mockImplementation(async () => ({ sessionLinked: false }));
    sessionChallengeMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });

    await expect(ensureDeviceKeyRegistration()).rejects.toThrow("offline");

    const deviceId = storageValues.get("encryption.device.id.user-a");
    if (!deviceId) throw new Error("The device id was not kept.");
    expect(secureStoreValues.has("encryption.device.privateKey.user-a")).toBe(true);
    expect(secureStoreValues.has("encryption.history.user-a.1")).toBe(true);
    expect(storageValues.has("encryption.device.registered")).toBe(false);
    expect((await ensureDeviceKeyRegistration()).deviceId).toBe(deviceId);
    expect(sessionChallengeMock).toHaveBeenCalledTimes(2);
  });
});
