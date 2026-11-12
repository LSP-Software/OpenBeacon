import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { SharingPreference } from "@openbeacon/shared";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { changeLocationSharing } from "../../lib/locationSharing.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let locallyPaused = false;
let sharingData: {
  account: SharingPreference;
  device: SharingPreference;
  paused: boolean;
};
const changes: Parameters<typeof changeLocationSharing>[0][] = [];
let invalidations = 0;
const preference = (paused: boolean): SharingPreference => ({
  sharingPaused: paused,
  sharingPausedUntil: null,
  sharingChangedAt: paused ? new Date() : null,
  sharingRevision: paused ? 1 : 0,
});
const Host = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
  React.createElement("host", props, children);
mock.module("react-native", () => ({ View: Host }));
mock.module("lucide-react-native", () => ({ PauseIcon: () => null }));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({ data: sharingData }),
  useQueryClient: () => ({
    invalidateQueries: async () => {
      invalidations += 1;
    },
  }),
  useMutation: ({ mutationFn }: { mutationFn: () => Promise<boolean> }) => ({
    isPending: false,
    mutateAsync: mutationFn,
  }),
}));
mock.module("../../lib/api.ts", () => ({
  trpc: {
    account: {
      locationSharing: { queryOptions: () => ({}), queryKey: () => [] },
      listDevices: { queryKey: () => [] },
    },
  },
}));
mock.module("../../lib/locationSharing.ts", () => ({
  changeLocationSharing: async (input: Parameters<typeof changeLocationSharing>[0]) => {
    changes.push(input);
    return "applied";
  },
  getPendingSharingChanges: () => ({ device: null, account: null }),
  hasLocallyPausedSharing: () => locallyPaused,
  serverNow: () => Date.now(),
}));
mock.module("../ui/Button.tsx", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("mock-button", props, children),
}));
mock.module("../ui/Text.tsx", () => ({ Text: Host }));
mock.module("../ui/Icon.tsx", () => ({ Icon: () => null }));
const { LocationSharingPausedBanner } = await import("./LocationSharingPausedBanner.tsx");

const render = async (polled: { paused: boolean; revisionPrefix: string } | null = null) => {
  root ??= createRoot();
  await act(async () =>
    root?.render(<LocationSharingPausedBanner polled={polled} subscribed userId="alex" />),
  );
  return JSON.stringify(root.container.toJSON());
};
const pressResume = async () => {
  const onPress = root?.container.queryAll((node) => node.type === "mock-button")[0]?.props[
    "onPress"
  ];
  if (typeof onPress !== "function") throw new Error("Missing Resume button");
  await act(async () => onPress());
};

beforeEach(() => {
  sharingData = {
    account: preference(false),
    device: preference(false),
    paused: false,
  };
  locallyPaused = false;
  changes.length = 0;
  invalidations = 0;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

test("stays hidden while this device is sharing", async () => {
  expect(await render()).not.toContain("paused");
});

test("shows when capture stopped locally before the server knows", async () => {
  locallyPaused = true;
  expect(await render()).toContain("Your location sharing is paused");
});

test("resuming clears both the account pause and this device's own pause", async () => {
  sharingData = {
    account: preference(true),
    device: preference(true),
    paused: true,
  };
  await render();
  await pressResume();
  expect(changes).toEqual([
    {
      scope: "account",
      paused: false,
      durationMinutes: null,
      expectedRevision: 1,
    },
    {
      scope: "device",
      paused: false,
      durationMinutes: null,
      expectedRevision: 1,
    },
  ]);
});

test("resuming an account pause leaves other devices' own pauses alone", async () => {
  sharingData = {
    account: preference(true),
    device: preference(false),
    paused: true,
  };
  await render();
  await pressResume();
  expect(changes).toEqual([
    {
      scope: "account",
      paused: false,
      durationMinutes: null,
      expectedRevision: 1,
    },
  ]);
});

test("follows the map poll's sharing state for this device", async () => {
  expect(await render({ paused: true, revisionPrefix: "s0.1:" })).toContain(
    "Your location sharing is paused",
  );
  expect(invalidations).toBe(0);
  expect(await render({ paused: false, revisionPrefix: "s0.2:" })).not.toContain("paused");
  expect(invalidations).toBe(1);
  await render({ paused: false, revisionPrefix: "s0.2:" });
  expect(invalidations).toBe(1);
});
