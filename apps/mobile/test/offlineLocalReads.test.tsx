import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type QueryObserverOptions,
  type QueryObserverResult,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "test-renderer";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const stored = new Map<string, string | boolean | number>([
  [
    "encryption.device.registered",
    JSON.stringify(["https://example.test", "user-1", "device-1", "pk"]),
  ],
]);

mock.module("react-native", () => ({
  ...createReactNativeTestModule(),
  Keyboard: { dismiss: () => {} },
}));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getString: (key: string) => stored.get(key),
    getBoolean: (key: string) => stored.get(key),
    getNumber: (key: string) => stored.get(key),
    set: (key: string, value: string | boolean | number) => stored.set(key, value),
  },
}));
mock.module("../lib/currentServer.ts", () => ({
  getBaseUrl: () => "https://example.test",
}));
mock.module("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0, SECRET: 1 },
  getEnrolledLevelAsync: async () => 1,
}));
mock.module("../modules/openbeacon-tracking/index.ts", () => ({ default: {} }));
mock.module("../lib/currentHistoryKey.ts", () => ({
  checkStoredHistoryKey: async () => ({ status: "held" }),
}));
mock.module("../lib/historyKeys.ts", () => ({
  getStoredHistoryKey: async () => new Uint8Array(),
}));

const { registeredDeviceQueryOptions } = await import("../lib/registeredDevice.ts");
const { phoneScreenLockQueryOptions } = await import("../lib/appLock.ts");
const { useHeldHistoryKeyVersions } = await import("../hooks/useHeldHistoryKeyVersions.ts");

beforeAll(() => onlineManager.setOnline(false));
afterAll(() => onlineManager.setOnline(true));

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const readOffline = async <T,>(options: QueryObserverOptions<T, Error, T, T, string[]>) => {
  const observer = new QueryObserver(new QueryClient(), options);
  let result: QueryObserverResult<T, Error> = observer.getCurrentResult();
  const unsubscribe = observer.subscribe((next) => {
    result = next;
  });
  await settle();
  unsubscribe();
  return result;
};

test("this phone's registration is read while the phone is offline", async () => {
  const result = await readOffline(registeredDeviceQueryOptions("user-1"));
  expect(result.data?.deviceId).toBe("device-1");
});

test("whether the phone has a screen lock is read while the phone is offline", async () => {
  const result = await readOffline(phoneScreenLockQueryOptions);
  expect(result.data).toBe(true);
});

test("the history keys held on this phone are read while the phone is offline", async () => {
  let held: number[] | undefined;
  const Probe = () => {
    held = useHeldHistoryKeyVersions("user-1", {
      publicKey: "pk",
      version: 2,
    }).data;
    return null;
  };
  const root = createRoot();
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  await act(settle);
  expect(held).toEqual([1, 2]);
  await act(async () => root.unmount());
});
