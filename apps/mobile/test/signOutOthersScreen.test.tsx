import { beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: unknown[][] = [];
const recheck = mock(async () => {});
const signOutOthers = mock(async (): Promise<{ signedOut: number }> => ({ signedOut: 1 }));
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

mock.module("expo-router", () => ({
  Link: View,
  router: { back: () => {} },
  useNavigation: () => ({ isFocused: () => true }),
}));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ mutateAsync: signOutOthers }),
  useQuery: () => ({ data: undefined }),
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
      deletionVerificationMethods: { queryOptions: () => ({}) },
      signOutOtherSessions: { mutationOptions: () => ({}) },
    },
  },
}));

const { default: SignOutOtherSessionsScreen } = await import("../app/account/sign-out-others.tsx");

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

const signOutAndCollectAlerts = async () => {
  const root = createRoot();
  await act(async () => root.render(<SignOutOtherSessionsScreen />));
  const button = root.container.queryAll((item) => item.type === "mock-button")[0];
  if (!button) throw new Error("Missing sign out button");
  await act(async () => (button.props as { onPress: () => void }).onPress());
  const [, , actions] = alerts.shift() as [
    string,
    string,
    { text: string; onPress?: () => void }[],
  ];
  const confirm = actions.find((action) => action.text === "Sign out others");
  await act(async () => confirm?.onPress?.());
  await act(async () => root.unmount());
  return alerts.map(([title, message]) => ({ title, message }));
};

beforeEach(() => {
  alerts.length = 0;
  recheck.mockClear();
  signOutOthers.mockReset();
});

test("a session that's too old to sign out others asks to sign in again", async () => {
  signOutOthers.mockImplementationOnce(async () => {
    throw forbidden("Sign in again to continue.", "FRESH_SIGN_IN_REQUIRED");
  });

  expect(await signOutAndCollectAlerts()).toEqual([
    {
      title: "Sign in again",
      message: "Nothing was signed out. Confirm it’s you, then try again.",
    },
  ]);
  expect(recheck).toHaveBeenCalledTimes(1);
});

test("a phone that isn't set up yet is told why instead of being asked to sign in again", async () => {
  signOutOthers.mockImplementationOnce(async () => {
    throw forbidden("Finish setting up this phone first.", "DEVICE_PENDING");
  });

  expect(await signOutAndCollectAlerts()).toEqual([
    { title: "Unable to sign out other sessions", message: "Finish setting up this phone first." },
  ]);
  expect(recheck).not.toHaveBeenCalled();
});
