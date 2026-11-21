import { beforeEach, expect, mock, test } from "bun:test";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { type Control, useController } from "react-hook-form";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: string[] = [];
const events: string[] = [];
let linkError: Error | null = null;
const signInResponses: { error: Record<string, unknown> | null }[] = [];
const signInHeaders: Record<string, string>[] = [];
const codeEntry: {
  props: {
    onSubmit: (code: string) => Promise<string | undefined>;
    onResend: () => Promise<string | undefined>;
    notice: string | undefined;
  } | null;
} = { props: null };
let currentUserId = "user-1";
const phone: { hasLock: boolean; result: "confirmed" | "noScreenLock" | "lockedOut" | "failed" } = {
  hasLock: true,
  result: "confirmed",
};
let methodsWaitingForNetwork = false;
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
  useQuery: (options: { queryKey?: string[] }) =>
    options.queryKey?.[0] === "phoneScreenLock"
      ? { data: phone.hasLock }
      : methodsWaitingForNetwork
        ? { data: undefined, isError: false, isLoading: false, isPending: true }
        : { data: { google: true, password: true }, isError: false, isPending: false },
}));
mock.module("../lib/appLock.ts", () => ({
  phoneScreenLockQueryOptions: { queryKey: ["phoneScreenLock"] },
  confirmWithPhoneLock: async () => {
    events.push("phoneLock");
    return phone.result;
  },
}));
mock.module("../components/LoadingIndicator.tsx", () => ({
  LoadingIndicator: () => React.createElement("loading-indicator"),
}));
mock.module("../components/EmailCodeEntry.tsx", () => ({
  EmailCodeEntry: (props: NonNullable<typeof codeEntry.props>) => {
    codeEntry.props = props;
    return null;
  },
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
let typedPassword = "secret";
mock.module("../components/ui/Input.tsx", () => ({
  Input: ({ control, name }: { control: Control<{ password: string }>; name: "password" }) => {
    const { field } = useController({ control, name });
    return React.createElement("mock-input", { onChangeText: field.onChange });
  },
}));
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
  useCanOfferGoogleSignIn: (providers: { google: boolean }) => providers.google,
  signInWithGoogle: async () => {
    events.push("google");
    return { data: {} };
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  saveSessionTokenToRevoke: async () => {},
  authClient: {
    getSession: async () => ({
      data: { session: { token: "token-2" }, user: { id: currentUserId } },
    }),
    revokeSession: async () => ({}),
    signIn: {
      email: async (input: { fetchOptions: { headers: Record<string, string> } }) => {
        signInHeaders.push(input.fetchOptions.headers);
        const response = signInResponses.shift() ?? { error: null };
        return { data: response.error ? null : {}, error: response.error };
      },
    },
    signOut: async () => {
      events.push("authSignOut");
      return {};
    },
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
mock.module("../lib/endSession.ts", () => ({
  endSession: async ({ reason }: { reason: string }) => {
    events.push(`endSession:${reason}`);
    return { signedOut: true };
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

const confirm = async (method: "password" | "google" = "password") => {
  const root = createRoot();
  await act(async () =>
    root.render(<ConfirmIdentity onConfirmed={() => events.push("confirmed")} />),
  );
  const button = root.container.queryAll((item) => item.type === "mock-button")[
    method === "password" ? 0 : 1
  ];
  if (!button) throw new Error("Missing continue button");
  const [input] = root.container.queryAll((item) => item.type === "mock-input");
  if (method === "password" && input) {
    await act(async () =>
      (input.props as { onChangeText: (text: string) => void }).onChangeText(typedPassword),
    );
  }
  await act(async () => (button.props as { onPress: () => Promise<void> }).onPress());
  await act(async () => root.unmount());
};

beforeEach(() => {
  alerts.length = 0;
  events.length = 0;
  linkError = null;
  signInResponses.length = 0;
  signInHeaders.length = 0;
  codeEntry.props = null;
  phone.hasLock = true;
  phone.result = "confirmed";
  methodsWaitingForNetwork = false;
  currentUserId = "user-1";
  typedPassword = "secret";
});

test("an empty password isn't sent, so it can't count towards the lockout", async () => {
  typedPassword = "";

  await confirm();

  expect(signInHeaders).toEqual([]);
  expect(alerts).toEqual([]);
});

test("picking a different Google account signs this phone out as a deliberate sign-out", async () => {
  currentUserId = "user-2";

  await confirm("google");

  expect(events).toEqual(["phoneLock", "google", "endSession:signedOut", "navigate:/"]);
});

test("shows it is loading while the sign-in methods wait for a connection", async () => {
  methodsWaitingForNetwork = true;
  const root = createRoot();
  await act(async () => root.render(<ConfirmIdentity onConfirmed={() => {}} />));
  expect(root.container.queryAll((item) => item.type === "loading-indicator")).toHaveLength(1);
  await act(async () => root.unmount());
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
      "Couldn’t confirm it’s you|This phone couldn’t confirm it’s yours. Check your connection and try again.",
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

test("a password confirmation never asks for the phone's screen lock", async () => {
  await confirm("password");

  expect(events).toEqual(["confirmed"]);
});

test("Google asks for the phone's screen lock before signing in", async () => {
  await confirm("google");

  expect(events).toEqual(["phoneLock", "google", "confirmed"]);
  expect(alerts).toEqual([]);
});

test("a cancelled or failed screen lock stops before Google", async () => {
  phone.result = "failed";

  await confirm("google");

  expect(events).toEqual(["phoneLock"]);
  expect(alerts).toEqual([]);
});

test("too many screen lock tries stops before Google and says to wait", async () => {
  phone.result = "lockedOut";

  await confirm("google");

  expect(events).toEqual(["phoneLock"]);
  expect(alerts).toEqual([
    "Couldn’t confirm it’s you|Too many tries. Wait a moment, then try again.",
  ]);
});

test("a phone with no screen lock goes on to Google", async () => {
  phone.hasLock = false;
  phone.result = "noScreenLock";

  await confirm("google");

  expect(events).toEqual(["phoneLock", "google", "confirmed"]);
});

test("a screen lock removed while confirming falls back to Google", async () => {
  phone.result = "noScreenLock";

  await confirm("google");

  expect(events).toEqual(["phoneLock", "google", "confirmed"]);
});

test("a password that needs a code signs in again with the code and reports wrong codes", async () => {
  signInResponses.push(
    { error: { status: 403, code: "SIGN_IN_CODE_REQUIRED", codeSent: true } },
    { error: { status: 400, code: "INVALID_CODE" } },
    { error: { status: 403, code: "SIGN_IN_CODE_REQUIRED", codeSent: false } },
  );
  const root = createRoot();
  await act(async () =>
    root.render(<ConfirmIdentity onConfirmed={() => events.push("confirmed")} />),
  );
  const [passwordButton] = root.container.queryAll((item) => item.type === "mock-button");
  if (!passwordButton) throw new Error("Missing password button");
  const [passwordInput] = root.container.queryAll((item) => item.type === "mock-input");
  await act(async () =>
    (passwordInput!.props as { onChangeText: (text: string) => void }).onChangeText("secret"),
  );
  await act(async () => (passwordButton.props as { onPress: () => Promise<void> }).onPress());
  const entry = () => {
    if (!codeEntry.props) throw new Error("Missing code entry");
    return codeEntry.props;
  };

  let error: string | undefined;
  await act(async () => {
    error = await entry().onSubmit("111111");
  });
  expect(error).toBe("The code is wrong or has expired. Check it, or send a new code.");

  await act(async () => {
    error = await entry().onResend();
  });
  expect(error).toContain("Use the last code");

  await act(async () => {
    error = await entry().onSubmit("222222");
  });
  expect(error).toBeUndefined();
  expect(signInHeaders.map((headers) => headers["x-openbeacon-sign-in-code"])).toEqual([
    undefined,
    "111111",
    undefined,
    "222222",
  ]);
  expect(events).toEqual(["confirmed"]);
  expect(alerts).toEqual([]);
  await act(async () => root.unmount());
});

test("a password changed elsewhere while entering a code goes back with an alert", async () => {
  signInResponses.push(
    { error: { status: 403, code: "SIGN_IN_CODE_REQUIRED", codeSent: true } },
    {
      error: {
        status: 401,
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      },
    },
  );
  const root = createRoot();
  await act(async () =>
    root.render(<ConfirmIdentity onConfirmed={() => events.push("confirmed")} />),
  );
  const [passwordButton] = root.container.queryAll((item) => item.type === "mock-button");
  if (!passwordButton) throw new Error("Missing password button");
  const [passwordInput] = root.container.queryAll((item) => item.type === "mock-input");
  await act(async () =>
    (passwordInput!.props as { onChangeText: (text: string) => void }).onChangeText("secret"),
  );
  await act(async () => (passwordButton.props as { onPress: () => Promise<void> }).onPress());
  let error: string | undefined = "unset";
  await act(async () => {
    error = await codeEntry.props?.onSubmit("111111");
  });

  expect(error).toBeUndefined();
  expect(alerts).toEqual(["Couldn’t confirm it’s you|Invalid email or password"]);
  expect(root.container.queryAll((item) => item.type === "mock-button").length).toBe(2);
  expect(events).toEqual([]);
  await act(async () => root.unmount());
});
