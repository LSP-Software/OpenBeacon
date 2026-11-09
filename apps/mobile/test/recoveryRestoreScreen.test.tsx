import { beforeEach, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let searchParams: { afterSignIn?: string; missingVersion?: string } = {};
let heldVersions: number[] = [];
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
mock.module("../lib/recovery.ts", () => ({ restoreFromRecoveryPhrase: async () => {} }));
mock.module("../lib/restoreReminders.ts", () => ({ skipRestorePrompt: () => {} }));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("../lib/resealPersonalData.ts", () => ({ resealPersonalData: async () => {} }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/RecoveryPhraseGrid.tsx", () => ({ RecoveryPhraseGrid: () => null }));
mock.module("../components/RecoveryCoverage.tsx", () => ({ RecoveryCoverage: () => null }));
mock.module("../components/ui/Button.tsx", () => ({ Button: View }));
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
});

test("after sign in without the current key, offers both skipping and resetting", async () => {
  searchParams = { afterSignIn: "true", missingVersion: "2" };
  const { rendered, resetLink } = await renderScreen();
  expect(rendered).toContain("Skip for now");
  expect(rendered).toContain("I’ve lost my phrase");
  expect(JSON.parse(resetLink.href)).toEqual({
    pathname: "/account/recovery-reset",
    params: { afterSignIn: "true" },
  });
  expect(resetLink.replace).toBe(false);
});

test("reached from elsewhere without the current key, offers resetting but not skipping", async () => {
  const { rendered, resetLink } = await renderScreen();
  expect(rendered).not.toContain("Skip for now");
  expect(rendered).toContain("I’ve lost my phrase");
  expect(JSON.parse(resetLink.href)).toBe("/account/recovery-reset");
  expect(resetLink.replace).toBe(true);
});

test("offers neither when the phone already holds the current key", async () => {
  heldVersions = [2];
  for (const params of [{}, { afterSignIn: "true" }]) {
    searchParams = params;
    const { rendered } = await renderScreen();
    expect(rendered).not.toContain("Skip for now");
    expect(rendered).not.toContain("I’ve lost my phrase");
  }
});
