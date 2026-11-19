import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { type Control, useController } from "react-hook-form";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const alerts: string[] = [];
let methods = { google: false, password: true };
const ownScreenWhileOpen: boolean[] = [];
const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

mock.module("expo-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  router: { replace: () => {} },
}));
mock.module("expo-web-browser", () => ({
  openAuthSessionAsync: async () => {
    const { isOwnScreenOpen } = await import("../lib/ownScreen.ts");
    ownScreenWhileOpen.push(isOwnScreenOpen());
    return {
      type: "success",
      url: "openbeacon://google-deletion?state=state-1&code=code-1",
    };
  },
}));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    mutateAsync: async () => ({ state: "state-1", url: "https://accounts.example/auth" }),
  }),
  useQuery: () => ({ data: methods, isError: false }),
}));
mock.module("react-native", () => ({ ScrollView: View, View }));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/headers/ScreenHeader.tsx", () => ({ ScreenHeader: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/ChoiceList.tsx", () => ({ ChoiceList: () => null }));
mock.module("../components/ui/Input.tsx", () => ({
  Input: ({ control, name }: { control: Control<{ password: string }>; name: "password" }) => {
    const { field } = useController({ control, name });
    return React.createElement("mock-input", { onChangeText: field.onChange });
  },
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/alert.ts", () => ({
  Alert: { alert: (title: string) => alerts.push(title) },
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    account: {
      beginGoogleDeletionVerification: { mutationOptions: () => ({}) },
      deletionVerificationMethods: { queryOptions: () => ({}) },
      requestDeletion: { mutationOptions: () => ({}) },
    },
  },
}));
mock.module("../lib/endSession.ts", () => ({ endSession: async () => ({ signedOut: true }) }));

const { default: DeleteAccountScreen } = await import("../app/account/delete.tsx");

const confirmDeletion = async (password: string) => {
  const root = createRoot();
  await act(async () => root.render(<DeleteAccountScreen />));
  const [input] = root.container.queryAll((item) => item.type === "mock-input");
  await act(async () =>
    (input!.props as { onChangeText: (text: string) => void }).onChangeText(password),
  );
  const button = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Confirm deletion"));
  if (!button) throw new Error("Missing Confirm deletion");
  await act(async () => (button.props as { onPress: () => Promise<void> }).onPress());
  await act(async () => root.unmount());
};

beforeEach(() => {
  alerts.length = 0;
  ownScreenWhileOpen.length = 0;
  methods = { google: false, password: true };
});

test("an empty password doesn't go on to ask about deleting", async () => {
  await confirmDeletion("");
  expect(alerts).toEqual([]);
});

test("a typed password goes on to ask about deleting", async () => {
  await confirmDeletion("secret");
  expect(alerts).toEqual(["Delete account?"]);
});

test("the Google check counts as the app's own screen, so app lock doesn't ask on the way back", async () => {
  methods = { google: true, password: false };
  const root = createRoot();
  await act(async () => root.render(<DeleteAccountScreen />));
  const button = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Verify with Google"));
  if (!button) throw new Error("Missing Verify with Google");
  await act(async () => (button.props as { onPress: () => Promise<void> }).onPress());
  await act(async () => root.unmount());

  const { isOwnScreenOpen } = await import("../lib/ownScreen.ts");
  expect(ownScreenWhileOpen).toEqual([true]);
  expect(isOwnScreenOpen()).toBe(false);
  expect(alerts).toEqual(["Delete account?"]);
});
