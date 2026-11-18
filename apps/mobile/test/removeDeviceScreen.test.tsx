import { beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: unknown[][] = [];
const recheck = mock(async () => {});
const removeDevice = mock(async (_input: { deviceId: string }): Promise<void> => {});
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

mock.module("expo-router", () => ({
  router: { back: () => {} },
  useLocalSearchParams: () => ({ deviceId: "device-2", name: "Old tablet" }),
  useNavigation: () => ({ isFocused: () => true }),
}));
let devices: { id: string; name: string }[] = [{ id: "device-2", name: "Old phone" }];
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: devices, isError: false, isPending: false }),
  useMutation: () => ({ mutateAsync: removeDevice }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("react-native", () => ({
  KeyboardAvoidingView: View,
  Platform: { OS: "ios", select: () => undefined },
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/ConfirmIdentity.tsx", () => ({
  ConfirmIdentity: () => React.createElement("confirm-identity"),
}));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../hooks/useIdentityGate.ts", () => ({
  useIdentityGate: () => ({ decision: "ready", recheck, refresh: async () => {} }),
}));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (...args: unknown[]) => {
      alerts.push(args);
    },
  },
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    account: {
      listDevices: { queryKey: () => [], queryOptions: () => ({}) },
      removeDevice: { mutationOptions: () => ({}) },
    },
    groupMembership: {
      listMemberDevices: { pathKey: () => [] },
    },
  },
}));

const { default: RemoveDeviceScreen } = await import("../app/account/remove-device.tsx");

const forbidden = (message: string, reason: string) =>
  TRPCClientError.from({
    error: {
      code: -32003,
      data: {
        code: "FORBIDDEN",
        cause: reason === "FRESH_SIGN_IN_REQUIRED" ? null : reason,
        reason,
      },
      message,
    },
  });

const removeAndCollectAlerts = async () => {
  const root = createRoot();
  await act(async () => root.render(<RemoveDeviceScreen />));
  const button = root.container.queryAll((item) => item.type === "mock-button")[0];
  if (!button) throw new Error("Missing remove button");
  await act(async () => (button.props as { onPress: () => void }).onPress());
  const [, , actions] = alerts.shift() as [
    string,
    string,
    { text: string; onPress?: () => void }[],
  ];
  const confirm = actions.find((action) => action.text === "Remove device");
  await act(async () => confirm?.onPress?.());
  await act(async () => root.unmount());
  return alerts.map(([title, message]) => ({ title, message }));
};

beforeEach(() => {
  devices = [{ id: "device-2", name: "Old phone" }];
  alerts.length = 0;
  recheck.mockClear();
  removeDevice.mockReset();
});

test("a session that's too old to remove devices asks to sign in again", async () => {
  removeDevice.mockImplementationOnce(async () => {
    throw forbidden("Sign in again to continue.", "FRESH_SIGN_IN_REQUIRED");
  });

  expect(await removeAndCollectAlerts()).toEqual([
    { title: "Sign in again", message: "Nothing was removed. Confirm it’s you, then try again." },
  ]);
  expect(recheck).toHaveBeenCalledTimes(1);
});

test("a phone that isn't set up yet is told why instead of being asked to sign in again", async () => {
  for (const [cause, message] of [
    ["DEVICE_PENDING", "Finish setting up this phone first."],
    ["DEVICE_UNVERIFIED", "This phone needs to confirm it's yours. Try again."],
  ] as const) {
    removeDevice.mockImplementationOnce(async () => {
      throw forbidden(message, cause);
    });

    expect(await removeAndCollectAlerts()).toEqual([{ title: "Unable to remove device", message }]);
    alerts.length = 0;
  }
  expect(recheck).not.toHaveBeenCalled();
});

test("a lost session says the person was signed out instead of showing UNAUTHORIZED", async () => {
  removeDevice.mockImplementationOnce(async () => {
    throw TRPCClientError.from({
      error: {
        code: -32001,
        data: { code: "UNAUTHORIZED", httpStatus: 401 },
        message: "UNAUTHORIZED",
      },
    });
  });

  expect(await removeAndCollectAlerts()).toEqual([
    {
      title: "Unable to remove device",
      message: "You’ve been signed out. Sign in again to keep using this phone.",
    },
  ]);
});

test("names the device from the account, not from the link", async () => {
  const root = createRoot();
  await act(async () => root.render(<RemoveDeviceScreen />));
  const button = root.container.queryAll((item) => item.type === "mock-button")[0];
  if (!button) throw new Error("Missing remove button");
  await act(async () => (button.props as { onPress: () => void }).onPress());
  await act(async () => root.unmount());

  expect(alerts[0]?.[0]).toBe("Remove Old phone?");
});

test("a device that is no longer on the account can't be removed", async () => {
  devices = [];
  const root = createRoot();
  await act(async () => root.render(<RemoveDeviceScreen />));
  const text = JSON.stringify(root.container.toJSON());
  const buttons = root.container.queryAll((item) => item.type === "mock-button");
  await act(async () => root.unmount());

  expect(text).toContain("This device is no longer on your account.");
  expect(buttons).toHaveLength(0);
});
