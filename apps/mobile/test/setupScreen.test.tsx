import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let deviceActive: boolean | Error = false;
let recoveryKey: object | null = {};
let deviceStatus: { data?: { accountHasActiveDevice?: boolean }; isError: boolean } = {
  data: { accountHasActiveDevice: true },
  isError: false,
};
const refetchDeviceStatus = mock(async () => {});
let signOutError: Error | null = null;
const replace = mock((_route: string) => {});
const signOutOfThisPhone = mock(
  async (_input: { removeThisPhone: boolean; sessionTokenToRevoke: string | null }) => {
    if (signOutError) throw signOutError;
    return { status: "signedOut" as const };
  },
);

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  Link: View,
  router: { replace },
  useFocusEffect: (callback: () => void) => useEffect(() => callback(), [callback]),
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string }) =>
    queryKey === "device"
      ? { ...deviceStatus, isPending: !deviceStatus.data, refetch: refetchDeviceStatus }
      : { data: { recoveryKey }, isError: false, isPending: false },
}));
mock.module("react-native", () => ({ ScrollView: View, View }));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    accountRecovery: { status: { queryOptions: () => ({ queryKey: "recovery" }) } },
    device: { status: { queryOptions: () => ({ queryKey: "device" }) } },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { session: { token: "session-token" } } }) },
}));
mock.module("../lib/signOut.ts", () => ({ signOutOfThisPhone }));
mock.module("../lib/deviceActivation.ts", () => ({
  isThisDeviceActive: async () => {
    if (deviceActive instanceof Error) throw deviceActive;
    return deviceActive;
  },
}));

const { default: SetUpPhoneScreen } = await import("../app/setup/index.tsx");

let root: Root | null = null;

const render = async () => {
  root = createRoot();
  await act(async () => root?.render(<SetUpPhoneScreen />));
};

const signOut = async () => {
  const button = root?.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Sign out"));
  if (!button) throw new Error("Missing Sign out");
  await act(async () => (button.props as { onPress: () => Promise<void> }).onPress());
};

const shownText = () => JSON.stringify(root?.container.toJSON() ?? null);

const linkOptions = ["Yes, link with your other phone", "Create a phrase on your other phone"];

beforeEach(() => {
  deviceActive = false;
  recoveryKey = {};
  deviceStatus = { data: { accountHasActiveDevice: true }, isError: false };
  refetchDeviceStatus.mockClear();
  signOutError = null;
  replace.mockClear();
  signOutOfThisPhone.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("a phone that's already set up leaves setup instead of offering it again", async () => {
  deviceActive = true;
  await render();
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("a phone that isn't set up stays on setup", async () => {
  await render();
  expect(replace).not.toHaveBeenCalled();
});

test("stays on setup when the device status can't be checked", async () => {
  deviceActive = new Error("offline");
  await render();
  expect(replace).not.toHaveBeenCalled();
});

test("Sign out uses the shared sign-out so a failed sign-out is revoked later", async () => {
  await render();
  await signOut();
  expect(signOutOfThisPhone.mock.calls.map(([input]) => input)).toMatchObject([
    { removeThisPhone: false, sessionTokenToRevoke: "session-token" },
  ]);
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("still leaves setup when signing out throws", async () => {
  signOutError = new Error("offline");
  await render();
  await signOut();
  expect(replace.mock.calls).toEqual([["/"]]);
});

test("hides linking when no other phone on the account is active", async () => {
  deviceStatus = { data: { accountHasActiveDevice: false }, isError: false };
  await render();
  expect(shownText()).not.toContain("Yes, link with your other phone");
  expect(shownText()).toContain("None of your other phones are signed in");
  expect(shownText()).toContain("Enter your recovery phrase");
  expect(shownText()).toContain("I’ve lost my phrase");
});

test("with no phrase and no other active phone, only offers starting fresh", async () => {
  deviceStatus = { data: { accountHasActiveDevice: false }, isError: false };
  recoveryKey = null;
  await render();
  for (const option of linkOptions) expect(shownText()).not.toContain(option);
  expect(shownText()).not.toContain("Enter your recovery phrase");
  expect(shownText()).toContain("Start fresh");
});

test.each([
  ["another phone is active", { data: { accountHasActiveDevice: true }, isError: false }],
  ["the check is still loading", { isError: false }],
  ["the check failed", { isError: true }],
  ["the server doesn't say", { data: {}, isError: false }],
])("keeps linking on offer when %s", async (_name, status) => {
  deviceStatus = status;
  recoveryKey = null;
  await render();
  for (const option of linkOptions) expect(shownText()).toContain(option);
});

test("checks again for another active phone each time setup is shown", async () => {
  await render();
  expect(refetchDeviceStatus).toHaveBeenCalled();
});
