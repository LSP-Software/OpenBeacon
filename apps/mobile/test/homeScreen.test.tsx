import { afterEach, expect, jest, mock, test } from "bun:test";
import React, { act, useEffect } from "react";
import { TRPCClientError } from "@trpc/client";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let focused = true;
let session: { user: { id: string; name: string }; session?: { token: string } } | null = null;
const tokensToRevoke: string[] = [];
let deviceActive: boolean | Error = true;
let savedLink: { linkId: string; psk: Uint8Array } | null | Error = null;
const replace = mock((_route: string) => {});
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("../components/AnnouncementBanner.tsx", () => ({ AnnouncementBanner: () => null }));
mock.module("expo-router", () => ({
  Link: View,
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
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/theme.ts", () => ({ useColors: () => ({ primary: "blue" }) }));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: session, isPending: false }) },
  saveSessionTokenToRevoke: async (token: string) => {
    tokensToRevoke.push(token);
  },
}));
mock.module("../lib/api.ts", () => ({ trpcClient: {} }));
mock.module("../lib/locationSharing.ts", () => ({
  abandonLocationSharingChanges: () => {},
  syncLocationSharing: async () => {},
}));
mock.module("../lib/registeredDevice.ts", () => ({ readRegisteredDevice: async () => null }));
mock.module("../lib/sessionLink.ts", () => ({ linkSessionToDevice: async () => {} }));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("../lib/tracking.ts", () => ({
  prepareTrackingSignOut: async () => {},
  resumeTracking: () => {},
}));

mock.module("../lib/currentServer.ts", () => ({
  getBaseUrl: () => "https://beacon.example.com",
  hasCustomServerUrl: () => true,
}));
mock.module("../lib/endSession.ts", () => ({ endSession: async () => ({ signedOut: false }) }));

mock.module("../lib/deviceActivation.ts", () => ({
  isThisDeviceActive: async () => {
    if (deviceActive instanceof Error) throw deviceActive;
    return deviceActive;
  },
}));

let registration: { deviceId: string; userId: string } | Error = {
  deviceId: "device-1",
  userId: "registered-user",
};
mock.module("../lib/deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => {
    if (registration instanceof Error) throw registration;
    return registration;
  },
  getRegisteredDeviceKey: async () => null,
}));
mock.module("../lib/savedDeviceLink.ts", () => ({
  deleteSavedDeviceLink: async () => {},
  saveDeviceLink: async () => {},
  readSavedDeviceLink: async () => {
    if (savedLink instanceof Error) throw savedLink;
    return savedLink;
  },
}));

let onboarding: { kind: string } | null = null;
const readOnboardingFor: string[] = [];
const startedOnboarding: string[] = [];
mock.module("../lib/onboarding.ts", () => ({
  readOnboarding: (userId: string) => {
    readOnboardingFor.push(userId);
    return onboarding;
  },
  startOnboarding: (userId: string, kind: string) => startedOnboarding.push(`${userId}:${kind}`),
}));

const { default: HomeScreen } = await import("../app/index.tsx");
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = null;
  replace.mockClear();
  deviceActive = true;
  savedLink = null;
  onboarding = null;
  registration = { deviceId: "device-1", userId: "registered-user" };
  readOnboardingFor.length = 0;
  tokensToRevoke.length = 0;
  startedOnboarding.length = 0;
});

const renderSignedIn = async () => {
  focused = true;
  session = { user: { id: "user-1", name: "Signed in" } };
  root = createRoot();
  await act(() => root?.render(<HomeScreen />));
};

test("an active device opens the map", async () => {
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/(tabs)/map"]]);
});

test("a Pending device starts onboarding as a new device instead of opening the map", async () => {
  deviceActive = false;
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/onboarding"]]);
  expect(startedOnboarding).toEqual(["registered-user:newDevice"]);
});

test("reads onboarding for the account this device is registered to", async () => {
  await renderSignedIn();
  expect(readOnboardingFor).toEqual(["registered-user"]);
});

test.each(["newAccount", "returning"])(
  "a Pending device restarts %s onboarding as a new device so it can restore first",
  async (kind) => {
    deviceActive = false;
    onboarding = { kind };
    await renderSignedIn();
    expect(replace.mock.calls).toEqual([["/onboarding"]]);
    expect(startedOnboarding).toEqual(["registered-user:newDevice"]);
  },
);

test("keeps loading and tries again when this device can't be registered", async () => {
  jest.useFakeTimers();
  try {
    registration = new Error("offline");
    await renderSignedIn();
    expect(replace).not.toHaveBeenCalled();

    registration = { deviceId: "device-1", userId: "registered-user" };
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(replace.mock.calls).toEqual([["/(tabs)/map"]]);
  } finally {
    jest.useRealTimers();
  }
});

test("a Pending device part way through onboarding carries on where it left off", async () => {
  deviceActive = false;
  onboarding = { kind: "newDevice" };
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/onboarding"]]);
  expect(startedOnboarding).toEqual([]);
});

test("an active device that hasn't finished onboarding goes back to it", async () => {
  onboarding = { kind: "newAccount" };
  await renderSignedIn();
  expect(replace.mock.calls).toEqual([["/onboarding"]]);
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
    expect(replace.mock.calls).toEqual([["/onboarding"]]);
  } finally {
    jest.useRealTimers();
  }
});

test("backs off the checks while the device status still can't be checked", async () => {
  jest.useFakeTimers();
  try {
    deviceActive = new Error("offline");
    await renderSignedIn();
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    deviceActive = false;
    await act(async () => {
      jest.advanceTimersByTime(14_000);
    });
    expect(replace).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(replace.mock.calls).toEqual([["/onboarding"]]);
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
  expect(replace.mock.calls).toEqual([["/onboarding"]]);
});

test("refreshing a session while the home screen is unfocused does not navigate away from account", async () => {
  focused = true;
  session = { user: { id: "user-1", name: "Before" } };
  root = createRoot();
  await act(() => root?.render(<HomeScreen />));
  expect(replace).toHaveBeenCalledTimes(1);
  focused = false;
  replace.mockClear();
  session = { user: { id: "user-1", name: "After" } };
  await act(() => root?.render(<HomeScreen />));
  expect(replace).not.toHaveBeenCalled();
});

test("signing out while the server can't be reached keeps the session to revoke later", async () => {
  registration = new Error("offline");
  focused = true;
  session = { user: { id: "user-1", name: "Signed in" }, session: { token: "session-token" } };
  root = createRoot();
  await act(() => root?.render(<HomeScreen />));
  const signOut = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Sign out"));
  if (!signOut) throw new Error("Missing Sign out");
  await act(async () => (signOut.props as { onPress: () => Promise<void> }).onPress());
  expect(tokensToRevoke).toEqual(["session-token"]);
});

test.each([
  [
    "key storage on this phone fails",
    new Error("Device key storage is unavailable."),
    "Device key storage is unavailable. Trying again automatically.",
  ],
  [
    "the server answers with an error",
    TRPCClientError.from({
      error: {
        code: -32603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
        message: "Internal server error",
      },
    }),
    "Something went wrong on the server. Trying again automatically.",
  ],
  [
    "the server can't be reached",
    TRPCClientError.from(new TypeError("Network request failed")),
    "Couldn’t connect to https://beacon.example.com.",
  ],
])("says what went wrong when %s", async (_, error, message) => {
  deviceActive = error;
  await renderSignedIn();
  const screen = JSON.stringify(root?.container.children);
  expect(screen).toContain(message);
  if (!message.startsWith("Couldn’t connect")) expect(screen).not.toContain("Couldn’t connect");
});
