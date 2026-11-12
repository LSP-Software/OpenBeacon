import { beforeEach, expect, mock, test } from "bun:test";
import type { DeviceSharingState } from "@openbeacon/shared";

const stored = new Map<string, string>();
const nativeStates: { owner: string; prefix: string; paused: boolean }[] = [];
let offline = false;
let nextRequestId = 0;
let nativeAccepted = true;
let registeredDeviceId = "phone";
let beforeMutation: (() => Promise<void>) | null = null;
let onNativePause = () => {};
let state: DeviceSharingState;
let query: () => Promise<DeviceSharingState>;
const changes: { scope: string; paused: boolean }[] = [];
mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("./base-url.ts", () => ({ baseUrl: "https://server.test" }));
mock.module("./createSecureId.ts", () => ({ createSecureId: () => `request-${++nextRequestId}` }));
mock.module("./deviceKeys.ts", () => ({
  getStoredDeviceId: () => registeredDeviceId,
  getRegisteredDeviceKey: async () => ({ userId: "alex", deviceId: registeredDeviceId }),
}));
mock.module("./trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
  },
}));
mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    setSharingState: (owner: string, _deviceId: string, prefix: string, paused: boolean) => {
      if (!nativeAccepted) return false;
      nativeStates.push({ owner, prefix, paused });
      if (paused) onNativePause();
      return true;
    },
  },
}));
mock.module("./api.ts", () => ({
  trpcClient: {
    account: {
      locationSharing: { query: () => query() },
      setLocationSharing: {
        mutate: async (input: { scope: string; paused: boolean }) => {
          if (offline) throw new Error("Offline");
          if (beforeMutation) await beforeMutation();
          changes.push(input);
          state = { ...state, paused: input.paused, revisionPrefix: `s0.${changes.length}:` };
        },
      },
    },
  },
}));
const {
  changeLocationSharing,
  hasPendingSharingPause,
  hasLocallyPausedSharing,
  getPendingSharingChanges,
  syncLocationSharing,
} = await import("./locationSharing.ts");

beforeEach(() => {
  stored.clear();
  nativeStates.length = 0;
  changes.length = 0;
  offline = false;
  nativeAccepted = true;
  registeredDeviceId = "phone";
  beforeMutation = null;
  onNativePause = () => {};
  state = {
    deviceId: "phone",
    userId: "alex",
    paused: false,
    pausedUntil: null,
    resumeAfter: null,
    revisionPrefix: "",
  };
  query = async () => ({ ...state });
});

test("stops locally while offline and retries the pause before applying server state", async () => {
  offline = true;
  await expect(
    changeLocationSharing({ scope: "device", paused: true, durationMinutes: null }),
  ).rejects.toThrow("Offline");
  expect(nativeStates.at(-1)?.paused).toBe(true);
  expect(hasPendingSharingPause("alex")).toBe(true);
  offline = false;
  await syncLocationSharing();
  expect(changes).toHaveLength(1);
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates.at(-1)).toEqual({
    owner: JSON.stringify(["https://server.test", "alex"]),
    prefix: "s0.1:",
    paused: true,
  });
});

test("keeps both device and account pauses pending across a network failure", async () => {
  offline = true;
  await expect(
    changeLocationSharing({ scope: "device", paused: true, durationMinutes: null }),
  ).rejects.toThrow();
  await expect(
    changeLocationSharing({ scope: "account", paused: true, durationMinutes: 60 }),
  ).rejects.toThrow();
  offline = false;
  await syncLocationSharing();
  expect(changes.map((change) => change.scope)).toEqual(["device", "account"]);
  expect(hasPendingSharingPause("alex")).toBe(false);
});

test("a failed resume keeps the native pause in place", async () => {
  await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
  offline = true;
  await expect(
    changeLocationSharing({ scope: "device", paused: false, durationMinutes: null }),
  ).rejects.toThrow();
  expect(nativeStates.at(-1)?.paused).toBe(true);
});

test("a response requested before a pause cannot resume capture afterwards", async () => {
  let release = () => {};
  let started = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const old = { ...state };
  let calls = 0;
  query = async () => {
    calls += 1;
    if (calls === 1) {
      started();
      await gate;
      return old;
    }
    return { ...state };
  };
  const stale = syncLocationSharing();
  await entered;
  let locallyStopped = () => {};
  const stopped = new Promise<void>((resolve) => {
    locallyStopped = resolve;
  });
  onNativePause = locallyStopped;
  const change = changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
  await stopped;
  expect(changes).toHaveLength(0);
  release();
  await Promise.all([stale, change]);
  expect(nativeStates.at(-1)?.paused).toBe(true);
});

test("serializes a pending account retry before a newer resume", async () => {
  offline = true;
  await expect(
    changeLocationSharing({ scope: "account", paused: true, durationMinutes: null }),
  ).rejects.toThrow();
  offline = false;
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  beforeMutation = async () => {
    entered();
    await gate;
  };
  const retry = syncLocationSharing();
  await started;
  const resume = changeLocationSharing({ scope: "account", paused: false, durationMinutes: null });
  release();
  await Promise.all([retry, resume]);
  expect(changes.map((change) => change.paused)).toEqual([true, false]);
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(nativeStates.at(-1)?.paused).toBe(false);
  expect(hasLocallyPausedSharing("alex")).toBe(false);
});

test("concurrent syncs submit a pending change once", async () => {
  offline = true;
  await expect(
    changeLocationSharing({ scope: "device", paused: true, durationMinutes: 15 }),
  ).rejects.toThrow();
  offline = false;
  await Promise.all([syncLocationSharing(), syncLocationSharing()]);
  expect(changes).toHaveLength(1);
});

test("binds device changes to the original account and explicit device", async () => {
  await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
  expect(changes[0]).toMatchObject({ expectedUserId: "alex", deviceId: "phone", scope: "device" });
});

test("does not claim a local stop when the native runtime rejected it", async () => {
  nativeAccepted = false;
  offline = true;
  await expect(
    changeLocationSharing({ scope: "account", paused: true, durationMinutes: null }),
  ).rejects.toThrow();
  expect(hasPendingSharingPause("alex")).toBe(true);
  expect(hasLocallyPausedSharing("alex")).toBe(false);
  expect(getPendingSharingChanges("alex").account?.scope).toBe("account");
});

test("a failed refresh does not turn a saved change into a failed mutation", async () => {
  query = async () => {
    throw new Error("Refresh failed");
  };
  await expect(
    changeLocationSharing({ scope: "device", paused: true, durationMinutes: null }),
  ).resolves.toBeUndefined();
  expect(changes).toHaveLength(1);
  expect(hasPendingSharingPause("alex")).toBe(false);
  expect(hasLocallyPausedSharing("alex")).toBe(true);
});

test("a replacement device does not replay the old device's local pause", async () => {
  offline = true;
  await expect(
    changeLocationSharing({ scope: "device", paused: true, durationMinutes: null }),
  ).rejects.toThrow();
  expect(hasLocallyPausedSharing("alex")).toBe(true);
  registeredDeviceId = "replacement";
  state = { ...state, deviceId: registeredDeviceId };
  offline = false;
  await syncLocationSharing();
  expect(changes).toEqual([]);
  expect(hasLocallyPausedSharing("alex")).toBe(false);
  expect(hasPendingSharingPause("alex")).toBe(false);
});
