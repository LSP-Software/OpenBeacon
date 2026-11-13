import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const steps: string[] = [];
const alerts: string[] = [];
const alertMessages: string[] = [];
let changeError: { code?: string; message: string } | null = null;
let linkError: Error | null = null;
const changePassword = mock(async (_input: { revokeOtherSessions: boolean }) => {
  steps.push("changePassword");
  return { error: changeError };
});
const ensureDeviceKeyRegistration = mock(async (input?: { linkSession?: boolean }) => {
  steps.push(`register:${input?.linkSession === true}`);
  if (linkError) throw linkError;
  return { deviceId: "device-1", userId: "user-1" };
});
const signOutAfterRefusedSessionLink = mock(async () => {
  steps.push("signOut");
});

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  Link: View,
  router: { back: () => steps.push("back") },
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ providerId: "credential" }], isError: false }),
}));
mock.module("@hookform/resolvers/zod", () => ({ zodResolver: () => undefined }));
mock.module("react-hook-form", () => ({
  useForm: () => ({
    control: {},
    handleSubmit: (submit: (values: Record<string, string>) => Promise<void>) => () =>
      submit({
        confirmNewPassword: "new-pass",
        currentPassword: "old-pass",
        newPassword: "new-pass",
      }),
    reset: () => {},
  }),
}));
mock.module("react-native", () => ({
  KeyboardAvoidingView: View,
  Platform: { OS: "ios", select: () => undefined },
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../lib/alert.ts", () => ({
  Alert: {
    alert: (title: string, message?: string) => {
      alerts.push(title);
      if (message) alertMessages.push(message);
    },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { changePassword, listAccounts: async () => ({ data: [] }) },
}));
mock.module("../lib/deviceKeys.ts", () => ({ ensureDeviceKeyRegistration }));
mock.module("../lib/sessionLink.ts", () => ({
  isSessionLinkRefused: (error: unknown) =>
    error instanceof TRPCClientError && error.data?.code === "FORBIDDEN",
  signOutAfterRefusedSessionLink,
}));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Input.tsx", () => ({ Input: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));

const { default: PasswordScreen } = await import("../app/account/password.tsx");

let root: Root | null = null;

const changeThePassword = async () => {
  root = createRoot();
  await act(async () => root?.render(<PasswordScreen />));
  const button = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Change password"));
  if (!button) throw new Error("Missing button Change password");
  await act(async () => (button.props as { onPress: () => Promise<void> }).onPress());
};

beforeEach(() => {
  steps.length = 0;
  alerts.length = 0;
  alertMessages.length = 0;
  changeError = null;
  linkError = null;
  signOutAfterRefusedSessionLink.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("links the new sign-in to this phone after changing the password", async () => {
  await changeThePassword();

  expect(steps).toEqual(["changePassword", "register:true", "back"]);
  expect(changePassword.mock.calls.at(-1)?.[0].revokeOtherSessions).toBe(true);
  expect(alerts).toEqual(["Password changed"]);
});

test("a failed password change doesn't try to link a sign-in", async () => {
  changeError = { message: "Wrong password" };
  await changeThePassword();

  expect(steps).toEqual(["changePassword"]);
  expect(alerts).toEqual(["Unable to change password"]);
});

test("a password lockout shows when to try again", async () => {
  changeError = { code: "TOO_MANY_PASSWORD_ATTEMPTS", message: "Too many requests" };
  await changeThePassword();

  expect(steps).toEqual(["changePassword"]);
  expect(alertMessages).toEqual(["Too many attempts. Try again in 15 minutes."]);
});

test("a link that can't reach the server still reports the password as changed", async () => {
  linkError = new TRPCClientError("Network request failed");
  await changeThePassword();

  expect(steps).toEqual(["changePassword", "register:true", "back"]);
  expect(alerts).toEqual(["Password changed"]);
});

test("a refused link signs this phone out", async () => {
  linkError = TRPCClientError.from({
    error: { code: -32003, data: { code: "FORBIDDEN", httpStatus: 403 }, message: "Refused" },
  });
  await changeThePassword();

  expect(steps).toEqual(["changePassword", "register:true", "signOut"]);
});
