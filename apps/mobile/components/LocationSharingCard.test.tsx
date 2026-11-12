import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { SharingPreference } from "@openbeacon/shared";
import type { setLocationSharingSchema } from "@openbeacon/schemas";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { z } from "zod";
import type { changeLocationSharing } from "../lib/locationSharing.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let locallyPaused = false;
let mutationError: Error | null = null;
let sharingData: { account: SharingPreference; device: SharingPreference };
let pendingAccount: z.infer<typeof setLocationSharingSchema> | null = null;
const changes: Parameters<typeof changeLocationSharing>[0][] = [];
const preference = (overrides: Partial<SharingPreference> = {}): SharingPreference => ({
  sharingPaused: false,
  sharingPausedUntil: null,
  sharingChangedAt: null,
  sharingRevision: 0,
  ...overrides,
});
const Host = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
  React.createElement("host", props, children);
mock.module("react-native", () => ({
  View: Host,
  ScrollView: Host,
  Pressable: Host,
  Modal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? children : null,
}));
mock.module("lucide-react-native", () => ({ MapPinIcon: () => null, PauseIcon: () => null }));
mock.module("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: sharingData, isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useMutation: () => ({
    isPending: false,
    mutateAsync: async (input: Parameters<typeof changeLocationSharing>[0]) => {
      if (mutationError) throw mutationError;
      changes.push(input);
    },
  }),
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    account: {
      locationSharing: { queryOptions: () => ({}), queryKey: () => [] },
      listDevices: { queryKey: () => [] },
    },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "alex" } } }) },
}));
mock.module("../lib/locationSharing.ts", () => ({
  changeLocationSharing: async () => {},
  hasPendingSharingPause: () => pendingAccount !== null,
  getPendingSharingChanges: () => ({ device: null, account: pendingAccount }),
  hasLocallyPausedSharing: () => locallyPaused,
}));
mock.module("./ui/Button.tsx", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("button", props, children),
}));
mock.module("./ui/Card.tsx", () => ({
  Card: Host,
  CardHeader: Host,
  CardContent: Host,
  CardTitle: Host,
}));
mock.module("./ui/Text.tsx", () => ({ Text: Host }));
mock.module("./ui/Icon.tsx", () => ({ Icon: () => null }));
const { LocationSharingCard } = await import("./LocationSharingCard.tsx");
const render = async () => {
  root = createRoot();
  await act(async () => root?.render(<LocationSharingCard />));
  return JSON.stringify(root.container.toJSON());
};
const press = async (label: string) => {
  const button = root?.container
    .queryAll((node) => node.type === "button")
    .findLast((node) => JSON.stringify(node.children).includes(label));
  const onPress = button?.props["onPress"];
  if (typeof onPress !== "function") throw new Error(`Missing button ${label}`);
  await act(async () => onPress());
};
const selectedDurations = () =>
  root?.container
    .queryAll((node) => node.props["accessibilityRole"] === "radio")
    .filter((node) => {
      const state = node.props["accessibilityState"];
      return (
        typeof state === "object" && state !== null && "checked" in state && state.checked === true
      );
    })
    .map((node) => JSON.stringify(node.children));
beforeEach(() => {
  sharingData = { account: preference(), device: preference() };
  pendingAccount = null;
  locallyPaused = false;
  mutationError = null;
  changes.length = 0;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

test("an account timer does not promise to resume an indefinitely paused tablet", async () => {
  const now = Date.now();
  sharingData.account = preference({
    sharingPaused: true,
    sharingPausedUntil: new Date(now + 60 * 60_000),
    sharingChangedAt: new Date(now),
    sharingRevision: 1,
  });
  sharingData.device = preference({
    sharingPaused: true,
    sharingChangedAt: new Date(now),
    sharingRevision: 1,
  });
  const output = await render();
  expect(output).toContain("Until you turn it back on");
  expect(output).not.toContain("Resumes ");
});

test("shows the later device deadline when the account pause ends sooner", async () => {
  const now = Date.now();
  const deviceDeadline = new Date(now + 8 * 60 * 60_000);
  sharingData.account = preference({
    sharingPaused: true,
    sharingPausedUntil: new Date(now + 60 * 60_000),
    sharingChangedAt: new Date(now),
    sharingRevision: 1,
  });
  sharingData.device = preference({
    sharingPaused: true,
    sharingPausedUntil: deviceDeadline,
    sharingChangedAt: new Date(now),
    sharingRevision: 1,
  });
  expect(await render()).toContain(
    `Resumes ${deviceDeadline.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`,
  );
});

test("editing a permanent pause preserves its duration selection", async () => {
  sharingData.device = preference({
    sharingPaused: true,
    sharingChangedAt: new Date(),
    sharingRevision: 1,
  });
  await render();
  await press("Change pause");
  expect(selectedDurations()?.some((label) => label.includes("Until I turn it back on"))).toBe(
    true,
  );
  expect(selectedDurations()?.some((label) => label.includes("1 hour"))).toBe(false);
});

test("editing a timed pause selects its original duration", async () => {
  const started = new Date(Date.now() - 60_000);
  sharingData.device = preference({
    sharingPaused: true,
    sharingChangedAt: started,
    sharingPausedUntil: new Date(started.getTime() + 8 * 60 * 60_000),
    sharingRevision: 1,
  });
  await render();
  await press("Change pause");
  expect(selectedDurations()?.some((label) => label.includes("8 hours"))).toBe(true);
});

test("resuming a pending account pause targets the account instead of the device", async () => {
  pendingAccount = { expectedUserId: "alex", scope: "account", paused: true, durationMinutes: 60 };
  locallyPaused = true;
  await render();
  await press("Resume all devices");
  expect(changes).toEqual([{ scope: "account", paused: false, durationMinutes: null }]);
});

test("does not claim capture stopped when the local pause failed", async () => {
  mutationError = new Error("Native pause failed");
  await render();
  await press("Pause sharing");
  await press("Pause sharing");
  const output = JSON.stringify(root?.container.toJSON());
  expect(output).toContain("Couldn't update location sharing");
  expect(output).not.toContain("Sharing stopped on this device");
});
