import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { createHistoryKeyPair, sealDeviceActivationChallenge } from "@openbeacon/encryption";

const navigations: unknown[] = [];
const storageValues = new Map<string, boolean>();
let statusQueries = 0;
let serverActivated = false;
let sessionLinked = true;
const links: string[] = [];
const historyKey = createHistoryKeyPair();
const deletedSavedLinks: { deviceId: string; userId: string }[] = [];

mock.module("expo-router", () => ({
  router: {
    replace: (target: unknown) => {
      navigations.push(target);
    },
  },
}));

mock.module("./api.ts", () => ({
  trpcClient: {
    device: {
      activate: { mutate: async () => ({ activated: true }) },
      activationChallenge: {
        mutate: async () => ({
          historyKeyVersion: 1,
          sealed: sealDeviceActivationChallenge({
            challenge: new Uint8Array(32),
            deviceId: "device-1",
            historyPublicKey: historyKey.publicKey,
            userId: "user-1",
          }),
        }),
      },
      status: {
        query: async () => {
          statusQueries += 1;
          return { activated: sessionLinked && serverActivated, registered: sessionLinked };
        },
      },
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({ deviceId: "device-1", userId: "user-1" }),
  getDeviceActiveKey: (deviceId: string) => `encryption.device.active.${deviceId}`,
}));

mock.module("./sessionLink.ts", () => ({
  linkSessionToDevice: async ({ deviceId }: { deviceId: string }) => {
    links.push(deviceId);
    sessionLinked = true;
  },
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async () => historyKey.privateKey,
}));

mock.module("./savedDeviceLink.ts", () => ({
  deleteSavedDeviceLink: async ({ deviceId, userId }: { deviceId: string; userId: string }) => {
    deletedSavedLinks.push({ deviceId, userId });
  },
}));

mock.module("./storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => storageValues.get(key),
    set: (key: string, value: boolean) => {
      storageValues.set(key, value);
    },
  },
}));

const { activateWithHistoryKey, handleDevicePending, isThisDeviceActive } =
  await import("./deviceActivation.ts");

const settle = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};

describe("device activation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    navigations.length = 0;
    storageValues.clear();
    statusQueries = 0;
    serverActivated = false;
    sessionLinked = true;
    links.length = 0;
    deletedSavedLinks.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("a burst of pending errors opens setup once, and again only after 10 seconds", async () => {
    handleDevicePending();
    handleDevicePending();
    await settle();
    expect(navigations).toEqual(["/setup"]);

    jest.setSystemTime(new Date("2026-11-11T12:00:09Z"));
    handleDevicePending();
    await settle();
    expect(navigations).toEqual(["/setup"]);

    jest.setSystemTime(new Date("2026-11-11T12:00:11Z"));
    handleDevicePending();
    await settle();
    expect(navigations).toEqual(["/setup", "/setup"]);
  });

  test("asks the server until this phone is active, then remembers it", async () => {
    expect(await isThisDeviceActive()).toBe(false);
    serverActivated = true;
    expect(await isThisDeviceActive()).toBe(true);
    expect(await isThisDeviceActive()).toBe(true);

    expect(statusQueries).toBe(2);
    expect(storageValues.get("encryption.device.active.device-1")).toBe(true);
  });

  test("a sign-in that hasn't proved this phone yet proves it before asking again", async () => {
    serverActivated = true;
    sessionLinked = false;

    expect(await isThisDeviceActive()).toBe(true);

    expect(links).toEqual(["device-1"]);
    expect(statusQueries).toBe(2);
  });

  test("restoring with the phrase forgets a link this phone saved", async () => {
    await activateWithHistoryKey();

    expect(storageValues.get("encryption.device.active.device-1")).toBe(true);
    expect(deletedSavedLinks).toEqual([{ deviceId: "device-1", userId: "user-1" }]);
  });
});
