import { beforeEach, expect, mock, test } from "bun:test";
import type { DeviceSharingState } from "@openbeacon/shared";

const stored = new Map<string, string>();
const nativeStates: { owner: string; prefix: string; paused: boolean }[] = [];
let offline = false;
let state: DeviceSharingState;
let query: () => Promise<DeviceSharingState>;
const changes: { scope: string; paused: boolean }[] = [];
mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("./base-url.ts", () => ({ baseUrl: "https://server.test" }));
mock.module("./deviceKeys.ts", () => ({
  getRegisteredDeviceKey: async () => ({ userId: "alex", deviceId: "phone" }),
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
    setSharingState: (owner: string, prefix: string, paused: boolean) =>
      nativeStates.push({ owner, prefix, paused }),
  },
}));
mock.module("./api.ts", () => ({
  trpcClient: {
    account: {
      locationSharing: { query: () => query() },
      setLocationSharing: {
        mutate: async (input: { scope: string; paused: boolean }) => {
          if (offline) throw new Error("Offline");
          changes.push(input);
          state = { ...state, paused: input.paused, revisionPrefix: `s0.${changes.length}:` };
        },
      },
    },
  },
}));
const { changeLocationSharing, hasPendingSharingPause, syncLocationSharing } =
  await import("./locationSharing.ts");

beforeEach(() => {
  stored.clear();
  nativeStates.length = 0;
  changes.length = 0;
  offline = false;
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
  await changeLocationSharing({ scope: "device", paused: true, durationMinutes: null });
  release();
  await stale;
  expect(nativeStates.at(-1)?.paused).toBe(true);
});
