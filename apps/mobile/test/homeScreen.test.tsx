import { afterEach, expect, jest, mock, test } from "bun:test";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let focused = true;
let session: { user: { name: string } } | null = null;
let deviceActive: boolean | Error = true;
let savedLink: { linkId: string; psk: Uint8Array } | null | Error = null;
const replace = mock((_route: string) => {});
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  router: { replace, push: () => {} },
  useRootNavigationState: () => ({ key: "root" }),
  useFocusEffect: (callback: () => (() => void) | undefined) =>
    useEffect(() => (focused ? callback() : undefined), [callback, focused]),
}));
mock.module("react-native", () => ({
  Animated: {
    Value: class {},
    loop: () => ({ start: () => {} }),
    sequence: () => ({}),
    timing: () => ({}),
    View,
  },
  Dimensions: { get: () => ({ width: 400 }) },
  Easing: { inOut: () => {}, sin: () => {} },
  Pressable: View,
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/BeaconIcon.tsx", () => ({ BeaconIcon: View }));
mock.module("../components/ui/Button.tsx", () => ({ Button: View }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/theme.ts", () => ({ useColors: () => ({ primary: "blue" }) }));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
}));

mock.module("../lib/deviceActivation.ts", () => ({
  isThisDeviceActive: async () => {
    if (deviceActive instanceof Error) throw deviceActive;
    return deviceActive;
  },
}));

mock.module("../lib/deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({ deviceId: "device-1", userId: "user-1" }),
}));
mock.module("../lib/savedDeviceLink.ts", () => ({
  deleteSavedDeviceLink: async () => {},
  saveDeviceLink: async () => {},
  readSavedDeviceLink: async () => {
    if (savedLink instanceof Error) throw savedLink;
    return savedLink;
  },
}));

const { default: HomeScreen } = await import("../app/index.tsx");
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = null;
  replace.mockClear();
  deviceActive = true;
  savedLink = null;
});

const renderSignedIn = async () => {
  focused = true;
  session = { user: { name: "Signed in" } };
  root = createRoot();
  await act(() => root?.render(<HomeScreen />));
};

test("an active device opens the map", async () => {
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/(tabs)/map"]]);
});

test("a Pending device opens setup instead of the map", async () => {
  deviceActive = false;
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/setup"]]);
});

test("keeps loading and checks again when the device status can't be checked", async () => {
  jest.useFakeTimers();
  try {
    deviceActive = new Error("offline");
    await renderSignedIn();
    expect(replace).not.toHaveBeenCalled();

    deviceActive = false;
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(replace.mock.calls).toEqual([["/setup"]]);
  } finally {
    jest.useRealTimers();
  }
});

test("stops checking once the home screen loses focus", async () => {
  jest.useFakeTimers();
  try {
    deviceActive = new Error("offline");
    await renderSignedIn();
    focused = false;
    await act(() => root?.render(<HomeScreen />));
    deviceActive = true;
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(replace).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("a Pending device with a saved setup code goes back to finish linking", async () => {
  deviceActive = false;
  savedLink = { linkId: "link-1", psk: new Uint8Array(32) };
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/setup/link"]]);
});

test("an active device with a saved setup code still goes back to finish linking", async () => {
  savedLink = { linkId: "link-1", psk: new Uint8Array(32) };
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/setup/link"]]);
});

test("routes as usual when the saved setup code can't be read", async () => {
  deviceActive = false;
  savedLink = new Error("Keychain locked");
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/setup"]]);
});

test("refreshing a session while the home screen is unfocused does not navigate away from account", async () => {
  focused = true;
  session = { user: { name: "Before" } };
  root = createRoot();
  await act(() => root?.render(<HomeScreen />));
  expect(replace).toHaveBeenCalledTimes(1);
  focused = false;
  replace.mockClear();
  session = { user: { name: "After" } };
  await act(() => root?.render(<HomeScreen />));
  expect(replace).not.toHaveBeenCalled();
});
