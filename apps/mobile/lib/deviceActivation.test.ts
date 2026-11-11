import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";

const navigations: unknown[] = [];
const storageValues = new Map<string, boolean>();
let statusQueries = 0;
let serverActivated = false;

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
      status: {
        query: async () => {
          statusQueries += 1;
          return { activated: serverActivated };
        },
      },
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({ deviceId: "device-1", userId: "user-1" }),
  getDeviceActiveKey: (deviceId: string) => `encryption.device.active.${deviceId}`,
}));

mock.module("./historyKeys.ts", () => ({ getStoredHistoryKey: async () => null }));

mock.module("./storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => storageValues.get(key),
    set: (key: string, value: boolean) => {
      storageValues.set(key, value);
    },
  },
}));

const { handleDevicePending, isThisDeviceActive } = await import("./deviceActivation.ts");

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
});
