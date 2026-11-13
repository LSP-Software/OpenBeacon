import { beforeEach, expect, mock, test } from "bun:test";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: string[] = [];
const events: string[] = [];
let linkError: Error | null = null;
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

mock.module("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  View,
}));
mock.module("expo-router", () => ({
  router: { replace: (target: string) => events.push(`navigate:${target}`) },
}));
mock.module("expo-secure-store", () => ({ setItemAsync: async () => {} }));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { google: false, password: true }, isError: false, isLoading: false }),
}));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Input.tsx", () => ({ Input: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/alert.ts", () => ({
  Alert: { alert: (title: string, message: string) => alerts.push(`${title}|${message}`) },
}));
mock.module("../lib/api.ts", () => ({
  queryClient: { invalidateQueries: async () => {} },
  trpc: { account: { deletionVerificationMethods: { queryOptions: () => ({}) } } },
  trpcClient: {},
}));
mock.module("../lib/auth.ts", () => ({
  isNativeGoogleSignInConfigured: false,
  signInWithGoogle: async () => ({}),
}));
mock.module("../lib/auth-client.ts", () => ({
  saveSessionTokenToRevoke: async () => {},
  authClient: {
    getSession: async () => ({
      data: { session: { token: "token-2" }, user: { id: "user-1" } },
    }),
    revokeSession: async () => ({}),
    signIn: { email: async () => ({ data: {}, error: null }) },
    signOut: async () => ({}),
    useSession: () => ({
      data: { session: { token: "token-1" }, user: { email: "a@example.com", id: "user-1" } },
    }),
  },
}));
mock.module("../lib/deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => {
    if (linkError) throw linkError;
    return {};
  },
}));
mock.module("../lib/signOut.ts", () => ({
  signOutOfThisPhone: async () => {
    events.push("signOut");
    return { status: "signedOut" };
  },
}));

const { ConfirmIdentity } = await import("../components/ConfirmIdentity.tsx");
const { SessionLinkChallengeUnopenableError } = await import("../lib/sessionLink.ts");

const serverError = (code: string, httpStatus: number, cause: string | null = null) =>
  TRPCClientError.from({
    error: { code: -32003, data: { cause, code, httpStatus, reason: cause }, message: "Refused" },
  });

const confirm = async () => {
  const root = createRoot();
  await act(async () =>
    root.render(<ConfirmIdentity onConfirmed={() => events.push("confirmed")} />),
  );
  const button = root.container.queryAll((item) => item.type === "mock-button")[0];
  if (!button) throw new Error("Missing continue button");
  await act(async () => (button.props as { onPress: () => Promise<void> }).onPress());
  await act(async () => root.unmount());
};

beforeEach(() => {
  alerts.length = 0;
  events.length = 0;
  linkError = null;
});

test("a removed phone shows no alert of its own", async () => {
  linkError = serverError("UNAUTHORIZED", 401, deviceRemovedCause);

  await confirm();

  expect(alerts).toEqual([]);
  expect(events).toEqual([]);
});

test("a link that can't reach the server asks to check the connection", async () => {
  for (const error of [
    TRPCClientError.from(new TypeError("Network request failed")),
    serverError("INTERNAL_SERVER_ERROR", 500),
  ]) {
    alerts.length = 0;
    linkError = error;

    await confirm();

    expect(alerts).toEqual([
      "Unable to confirm it’s you|This phone couldn’t confirm it’s yours. Check your connection and try again.",
    ]);
    expect(events).toEqual([]);
  }
});

test("a link the server refuses signs out once with the session-link message", async () => {
  linkError = serverError("CONFLICT", 409);

  await confirm();

  expect(events).toEqual(["signOut", "navigate:/"]);
  expect(alerts).toEqual(["You’ve been signed out|Sign in again to keep using this phone."]);
});

test("a challenge this phone can't open signs out once instead of blaming the connection", async () => {
  linkError = new SessionLinkChallengeUnopenableError();

  await confirm();

  expect(events).toEqual(["signOut", "navigate:/"]);
  expect(alerts).toEqual(["You’ve been signed out|Sign in again to keep using this phone."]);
});

test("a confirmed link finishes", async () => {
  await confirm();

  expect(events).toEqual(["confirmed"]);
  expect(alerts).toEqual([]);
});
