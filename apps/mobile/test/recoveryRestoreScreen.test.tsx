import { beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let searchParams: { setup?: string } = {};
let heldVersions: number[] = [];
const replace = mock((_route: string) => {});
const restoreFromRecoveryPhrase = mock(async () => ({ userId: "user-1" }));
const activateWithHistoryKey = mock(async () => {});
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
  router: { back: () => {}, replace },
  useLocalSearchParams: () => searchParams,
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { currentHistoryKey: { publicKey: "public-key", version: 2 }, recoveryKey: {} },
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("expo-screen-capture", () => ({
  allowScreenCaptureAsync: async () => {},
  disableAppSwitcherProtectionAsync: async () => {},
  enableAppSwitcherProtectionAsync: async () => {},
  preventScreenCaptureAsync: async () => {},
}));
mock.module("react-native", () => ({
  KeyboardAvoidingView: View,
  Platform: { OS: "ios", select: () => undefined },
  ScrollView: View,
  View,
}));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../lib/alert.ts", () => ({ Alert: { alert: () => {} } }));
mock.module("../lib/api.ts", () => ({
  trpc: { accountRecovery: { status: { queryOptions: () => ({}), queryKey: () => [] } } },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
mock.module("../hooks/useHeldHistoryKeyVersions.ts", () => ({
  useHeldHistoryKeyVersions: () => ({ data: heldVersions }),
}));
mock.module("@openbeacon/encryption", () => ({
  diagnoseRecoveryPhraseInput: () => ({ problem: "checksum" }),
  parseRecoveryPhrase: () => new Uint8Array(16),
}));
mock.module("../lib/recovery.ts", () => ({ restoreFromRecoveryPhrase }));
mock.module("../lib/deviceActivation.ts", () => ({ activateWithHistoryKey }));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("../lib/resealPersonalData.ts", () => ({ resealPersonalData: async () => {} }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/RecoveryPhraseGrid.tsx", () => ({
  RecoveryPhraseGrid: ({ onChangeWords }: { onChangeWords: (words: string[]) => void }) =>
    React.createElement("phrase-grid", { onChangeWords }),
}));
mock.module("../components/RecoveryCoverage.tsx", () => ({ RecoveryCoverage: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));

const { default: RecoveryRestoreScreen } = await import("../app/account/recovery-restore.tsx");

const renderScreen = async () => {
  const root = createRoot();
  await act(async () => root.render(<RecoveryRestoreScreen />));
  const rendered = JSON.stringify(root.container.toJSON());
  const [resetLink] = root.container.queryAll((item) => item.type === "expo-link");
  await act(async () => root.unmount());
  return { rendered, resetLink: resetLink?.props as { href: string; replace?: boolean } };
};

beforeEach(() => {
  searchParams = {};
  heldVersions = [1];
  replace.mockClear();
  restoreFromRecoveryPhrase.mockClear();
  activateWithHistoryKey.mockClear();
});

test("setting up a new phone without the current key offers resetting and never skipping", async () => {
  searchParams = { setup: "true" };
  const { rendered, resetLink } = await renderScreen();
  expect(rendered).not.toContain("Skip for now");
  expect(rendered).toContain("I’ve lost my phrase");
  expect(JSON.parse(resetLink.href)).toEqual({
    pathname: "/account/recovery-reset",
    params: { setup: "true" },
  });
});

test("reached from Account without the current key, offers resetting", async () => {
  const { rendered, resetLink } = await renderScreen();
  expect(rendered).not.toContain("Skip for now");
  expect(rendered).toContain("I’ve lost my phrase");
  expect(JSON.parse(resetLink.href)).toBe("/account/recovery-reset");
  expect(resetLink.replace).toBe(true);
});

test("doesn't offer resetting when the phone already holds the current key", async () => {
  heldVersions = [2];
  for (const params of [{}, { setup: "true" }]) {
    searchParams = params;
    const { rendered } = await renderScreen();
    expect(rendered).not.toContain("I’ve lost my phrase");
  }
});

test("when setting up fails after the phrase is restored, Try again only retries setting up", async () => {
  searchParams = { setup: "true" };
  activateWithHistoryKey.mockImplementationOnce(async () => {
    throw new TRPCClientError("Network request failed");
  });
  const root = createRoot();
  await act(async () => root.render(<RecoveryRestoreScreen />));
  const press = async (label: string) => {
    const button = root.container
      .queryAll((item) => item.type === "mock-button")
      .find((item) => JSON.stringify(item.children).includes(label));
    if (!button) throw new Error(`Missing button ${label}`);
    await act(async () => (button.props as { onPress: () => Promise<void> }).onPress());
  };
  const [grid] = root.container.queryAll((item) => item.type === "phrase-grid");
  if (!grid) throw new Error("Missing phrase grid");
  await act(async () =>
    (grid.props as { onChangeWords: (words: string[]) => void }).onChangeWords(
      Array.from({ length: 12 }, () => "word"),
    ),
  );
  await press("Restore");

  const rendered = JSON.stringify(root.container.toJSON());
  expect(rendered).toContain("We couldn’t reach your server");
  expect(rendered).not.toContain("Restore your history");
  expect(replace).not.toHaveBeenCalled();

  await press("Try again");

  expect(restoreFromRecoveryPhrase).toHaveBeenCalledTimes(1);
  expect(activateWithHistoryKey).toHaveBeenCalledTimes(2);
  expect(replace.mock.calls).toEqual([["/setup/name"]]);
  await act(async () => root.unmount());
});
