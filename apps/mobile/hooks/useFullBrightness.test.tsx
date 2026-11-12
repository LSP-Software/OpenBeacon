import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: { OS: "ios" | "android" } = { OS: "ios" };
const appStateListeners = new Set<(state: string) => void>();
let screenBrightness = 0.4;
let failures: { get?: boolean; set?: boolean; restore?: boolean } = {};
const calls: string[] = [];

mock.module("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  },
  Platform: platform,
}));

mock.module("expo-brightness", () => ({
  getBrightnessAsync: async () => {
    calls.push("get");
    if (failures.get) throw new Error("No brightness");
    return screenBrightness;
  },
  setBrightnessAsync: async (value: number) => {
    calls.push(`set:${value}`);
    if (failures.set) throw new Error("Can't set brightness");
    screenBrightness = value;
  },
  restoreSystemBrightnessAsync: async () => {
    calls.push("restore");
    if (failures.restore) throw new Error("Can't restore brightness");
  },
}));

const { useFullBrightness } = await import("./useFullBrightness.ts");

const FullBrightness = () => {
  useFullBrightness();
  return null;
};

let root: Root | null = null;

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

const show = async () => {
  root = createRoot();
  await act(async () => root?.render(<FullBrightness />));
  await settle();
};

const hide = async () => {
  await act(async () => root?.unmount());
  root = null;
  await settle();
};

const changeAppState = async (state: string) => {
  for (const listener of [...appStateListeners]) listener(state);
  await settle();
};

beforeEach(() => {
  platform.OS = "ios";
  screenBrightness = 0.4;
  failures = {};
  calls.length = 0;
  appStateListeners.clear();
});

afterEach(async () => {
  if (root) await hide();
});

test("on iOS, turns brightness up while shown and puts the previous level back when hidden", async () => {
  await show();
  expect(screenBrightness).toBe(1);

  await hide();
  expect(screenBrightness).toBe(0.4);
  expect(calls).toEqual(["get", "set:1", "set:0.4"]);
  expect(appStateListeners.size).toBe(0);
});

test("on iOS, puts the previous level back when the app goes to the background and turns it up again on return", async () => {
  await show();
  await changeAppState("inactive");
  expect(screenBrightness).toBe(1);

  await changeAppState("background");
  expect(screenBrightness).toBe(0.4);

  screenBrightness = 0.6;
  await changeAppState("active");
  expect(screenBrightness).toBe(1);

  await hide();
  expect(screenBrightness).toBe(0.6);
});

test("returning to the app twice doesn't save full brightness as the level to restore", async () => {
  await show();
  await changeAppState("active");
  await changeAppState("active");

  await hide();
  expect(screenBrightness).toBe(0.4);
  expect(calls).toEqual(["get", "set:1", "set:0.4"]);
});

test("hiding straight away still leaves the screen as it was", async () => {
  root = createRoot();
  await act(async () => root?.render(<FullBrightness />));
  await act(async () => root?.unmount());
  root = null;
  await settle();

  expect(screenBrightness).toBe(0.4);
});

test("on Android, hands brightness back to the system when hidden or backgrounded", async () => {
  platform.OS = "android";
  await show();
  expect(screenBrightness).toBe(1);

  await changeAppState("background");
  await changeAppState("active");
  await hide();

  expect(calls).toEqual(["set:1", "restore", "set:1", "restore"]);
});

test("does nothing if the current brightness can't be read", async () => {
  failures.get = true;
  await show();
  await hide();

  expect(calls).toEqual(["get"]);
  expect(screenBrightness).toBe(0.4);
});

test("never throws when brightness can't be changed", async () => {
  failures.set = true;
  failures.restore = true;
  await show();
  await changeAppState("background");
  await changeAppState("active");
  await hide();

  platform.OS = "android";
  await show();
  await hide();

  expect(calls.filter((call) => call === "restore")).toHaveLength(1);
});
