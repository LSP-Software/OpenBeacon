import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ResetResult =
  | { status: "unsaved"; device: { userId: string } }
  | { status: "reset"; device: { userId: string } };

let searchParams: { setup?: string } = {};
const backHandlers = new Set<() => boolean>();
let gestureEnabled: boolean | undefined;
const pressHardwareBack = () => [...backHandlers].some((handler) => handler());
const resetRecoveryPhrase = mock(async (): Promise<ResetResult> => ({
  status: "reset",
  device: { userId: "user-1" },
}));
const protectHistory = mock(async () => {});
let serverActive = true;
const steps: string[] = [];
const isThisDeviceActive = mock(async () => {
  steps.push("checkActive");
  return serverActive;
});
const activateWithHistoryKey = mock(async () => {
  steps.push("activate");
  serverActive = true;
});

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({
  Link: ({
    children,
    href,
    replace,
  }: {
    children: React.ReactNode;
    href: unknown;
    replace?: boolean;
  }) => React.createElement("expo-link", { href: JSON.stringify(href), replace }, children),
  router: { back: () => {}, replace: () => {} },
  Stack: {
    Screen: ({ options }: { options: { gestureEnabled?: boolean } }) => {
      gestureEnabled = options.gestureEnabled;
      return null;
    },
  },
  useFocusEffect: (effect: () => () => void) => React.useEffect(effect, [effect]),
  useLocalSearchParams: () => searchParams,
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { email: false }, isPending: false, refetch: async () => {} }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("react-hook-form", () => ({
  useForm: () => ({ control: {} }),
  useWatch: () => "RESET",
}));
mock.module("react-native", () => ({
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      backHandlers.add(handler);
      return { remove: () => backHandlers.delete(handler) };
    },
  },
  KeyboardAvoidingView: View,
  Platform: { OS: "ios", select: () => undefined },
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    accountRecovery: { status: { queryKey: () => [] } },
    auth: { providers: { queryOptions: () => ({}) } },
  },
}));
mock.module("../lib/emailCodes.ts", () => ({ invalidCodeMessage: "Invalid code" }));
mock.module("../lib/protectHistory.ts", () => ({ protectHistory }));
mock.module("../lib/deviceActivation.ts", () => ({ activateWithHistoryKey, isThisDeviceActive }));
mock.module("../lib/recovery.ts", () => ({
  requestRecoveryResetCode: async () => ({ status: "sent", email: "a@b.c" }),
  resetRecoveryPhrase,
  verifyRecoveryResetCode: async () => ({ status: "invalidCode" }),
}));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("../hooks/useIdentityGate.ts", () => ({
  useIdentityGate: () => ({ decision: "ready", recheck: async () => {}, refresh: async () => {} }),
}));
mock.module("../components/ConfirmIdentity.tsx", () => ({ ConfirmIdentity: () => null }));
mock.module("../components/EmailCodeEntry.tsx", () => ({ EmailCodeEntry: () => null }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/NewRecoveryPhrase.tsx", () => ({
  NewRecoveryPhrase: ({ onConfirm }: { onConfirm: (phrase: Uint8Array) => Promise<void> }) =>
    React.createElement("new-phrase", { onConfirm }),
}));
mock.module("../components/RecoveryCoverage.tsx", () => ({ RecoveryCoverage: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Input.tsx", () => ({ Input: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));

const { default: RecoveryResetScreen } = await import("../app/account/recovery-reset.tsx");

let root: Root | null = null;

const reachPhraseStep = async () => {
  root = createRoot();
  await act(async () => root?.render(<RecoveryResetScreen />));
  const button = root.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes("Continue"));
  if (!button) throw new Error("Missing button Continue");
  await act(async () => (button.props as { onPress: () => void }).onPress());
  const [phrase] = root.container.queryAll((item) => item.type === "new-phrase");
  if (!phrase) throw new Error("Missing new phrase step");
  return phrase.props as { onConfirm: (phrase: Uint8Array) => Promise<void> };
};

beforeEach(() => {
  searchParams = {};
  gestureEnabled = undefined;
  resetRecoveryPhrase.mockClear();
  protectHistory.mockClear();
  serverActive = true;
  steps.length = 0;
  isThisDeviceActive.mockClear();
  activateWithHistoryKey.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("back is blocked while the new phrase is being saved and history protected", async () => {
  let saved = () => {};
  resetRecoveryPhrase.mockImplementationOnce(
    () =>
      new Promise<ResetResult>((resolve) => {
        saved = () => resolve({ status: "reset", device: { userId: "user-1" } });
      }),
  );
  let protectedHistory = () => {};
  protectHistory.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        protectedHistory = resolve;
      }),
  );
  const { onConfirm } = await reachPhraseStep();
  expect(pressHardwareBack()).toBe(false);
  expect(gestureEnabled).toBe(true);

  await act(async () => {
    void onConfirm(new Uint8Array(16));
  });
  expect(resetRecoveryPhrase).toHaveBeenCalledTimes(1);
  expect(pressHardwareBack()).toBe(true);
  expect(gestureEnabled).toBe(false);

  await act(async () => saved());
  expect(protectHistory).toHaveBeenCalledTimes(1);
  expect(pressHardwareBack()).toBe(true);
  expect(gestureEnabled).toBe(false);

  await act(async () => protectedHistory());
  expect(JSON.stringify(root?.container.toJSON())).toContain("Your phrase is reset");
  expect(pressHardwareBack()).toBe(false);
  expect(gestureEnabled).toBe(true);
});

test("a phrase this phone couldn't save links to restoring it in place of this screen", async () => {
  for (const [params, href] of [
    [{}, "/account/recovery-restore"],
    [{ setup: "true" }, { pathname: "/account/recovery-restore", params: { setup: "true" } }],
  ] as const) {
    searchParams = params;
    resetRecoveryPhrase.mockImplementationOnce(async () => ({
      status: "unsaved",
      device: { userId: "user-1" },
    }));
    const { onConfirm } = await reachPhraseStep();
    await act(async () => onConfirm(new Uint8Array(16)));

    const [link] = root?.container.queryAll((item) => item.type === "expo-link") ?? [];
    const props = link?.props as { href: string; replace?: boolean };
    expect(JSON.parse(props.href)).toEqual(href);
    expect(props.replace).toBe(true);
    await act(async () => root?.unmount());
    root = null;
  }
});

test("a reset picks up that the server set this phone up before protecting history", async () => {
  searchParams = { setup: "true" };
  protectHistory.mockImplementationOnce(async () => {
    steps.push("protect");
  });
  const { onConfirm } = await reachPhraseStep();
  await act(async () => onConfirm(new Uint8Array(16)));
  expect(steps).toEqual(["checkActive", "protect"]);
  expect(activateWithHistoryKey).not.toHaveBeenCalled();
});

test("re-entering the account's current phrase sets this phone up with it before protecting history", async () => {
  searchParams = { setup: "true" };
  serverActive = false;
  protectHistory.mockImplementationOnce(async () => {
    steps.push("protect");
  });
  const { onConfirm } = await reachPhraseStep();
  await act(async () => onConfirm(new Uint8Array(16)));
  expect(steps).toEqual(["checkActive", "activate", "protect"]);
});

test("a phrase this phone couldn't save doesn't try to set the phone up with it", async () => {
  searchParams = { setup: "true" };
  serverActive = false;
  resetRecoveryPhrase.mockImplementationOnce(async () => ({
    status: "unsaved",
    device: { userId: "user-1" },
  }));
  const { onConfirm } = await reachPhraseStep();
  await act(async () => onConfirm(new Uint8Array(16)));
  expect(isThisDeviceActive).toHaveBeenCalledTimes(1);
  expect(activateWithHistoryKey).not.toHaveBeenCalled();
});
