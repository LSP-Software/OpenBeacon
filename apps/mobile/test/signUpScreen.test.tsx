import { afterEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let providers: { email: boolean; google: boolean } | undefined;
const refetches: string[] = [];

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  Link: View,
  router: { replace: () => {}, push: () => {} },
  useLocalSearchParams: () => ({}),
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: providers,
    isFetching: false,
    isPending: false,
    refetch: async () => {
      refetches.push("providers");
    },
  }),
}));
mock.module("react-native", () => ({ Platform: { OS: "android" }, Pressable: View, View }));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/EmailCodeEntry.tsx", () => ({ EmailCodeEntry: () => null }));
mock.module("../components/KeyboardFormScrollView.tsx", () => ({
  KeyboardFormScrollView: ({ children }: { children: (props: object) => React.ReactNode }) =>
    children({}),
}));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/HeldKeysNotice.tsx", () => ({ HeldKeysNotice: () => null }));
mock.module("../components/ServerNotice.tsx", () => ({ ServerNotice: () => null }));
mock.module("../components/headers/ReturnToHomeHeader.tsx", () => ({
  ReturnToHomeHeader: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Input.tsx", () => ({
  Input: ({ label }: { label: string }) => React.createElement("mock-input", { label }),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../lib/api.ts", () => ({
  trpc: { auth: { providers: { queryOptions: () => ({}) } } },
}));
mock.module("../lib/auth.ts", () => ({
  completeAuthenticatedSessionSetup: async () => ({}),
  useCanOfferGoogleSignIn: () => false,
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { signUp: { email: async () => ({}) } },
}));
mock.module("../lib/emailCodes.ts", () => ({ emailCodeErrorMessage: () => "", emailCodes: {} }));
mock.module("../lib/finishAuthentication.ts", () => ({ finishAuthentication: async () => {} }));
mock.module("../lib/googleAuth.ts", () => ({ performGoogleAuth: async () => {} }));

const { default: SignUp } = await import("../app/signUp.tsx");
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = null;
  refetches.length = 0;
});

const render = async () => {
  root = createRoot();
  await act(() => root?.render(<SignUp />));
  return root;
};

test("a sign-up form that couldn't learn the server's options offers to try again instead of the password form", async () => {
  providers = undefined;
  const rendered = await render();
  const screen = JSON.stringify(rendered.container.children);

  expect(screen).toContain("Couldn’t load sign-up options. Check your connection and try again.");
  expect(rendered.container.queryAll((item) => item.type === "mock-input")).toHaveLength(0);
  const retry = rendered.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Try again"));
  if (!retry) throw new Error("Missing Try again");
  await act(async () => (retry.props as { onPress: () => void }).onPress());
  expect(refetches).toEqual(["providers"]);
});

test("a server that verifies email asks for the email first", async () => {
  providers = { email: true, google: false };
  const rendered = await render();

  expect(
    rendered.container
      .queryAll((item) => item.type === "mock-input")
      .map((item) => (item.props as { label: string }).label),
  ).toEqual(["Email"]);
});
