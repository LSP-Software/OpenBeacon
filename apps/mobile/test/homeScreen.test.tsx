import { afterEach, expect, mock, test } from "bun:test";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let focused = true;
let session: { user: { name: string } } | null = null;
let deviceActive: boolean | Error = true;
const replace = mock((_route: string) => {});
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  router: { replace, push: () => {} },
  useRootNavigationState: () => ({ key: "root" }),
  useFocusEffect: (callback: () => void) =>
    useEffect(() => {
      if (focused) callback();
    }, [callback, focused]),
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

const { default: HomeScreen } = await import("../app/index.tsx");
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = null;
  replace.mockClear();
  deviceActive = true;
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

test("opens the map when the device status can't be checked", async () => {
  deviceActive = new Error("offline");
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/(tabs)/map"]]);
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
