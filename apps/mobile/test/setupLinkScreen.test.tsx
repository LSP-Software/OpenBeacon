import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HANDOVER_REJECTED_MESSAGE = "handover rejected";
const approvedStatus = {
  approverPublicKey: "approver-public-key",
  ciphertext: "ciphertext",
  enc: "enc",
  state: "approved" as const,
};

let statusData: { state: string } | undefined;
let queryOptions: {
  enabled?: boolean;
  refetchInterval?: (query: { state: { data: { state: string } | undefined } }) => number | false;
} = {};
const replace = mock((_route: string) => {});
const createLink = mock(async (): Promise<{ linkId: string }> => ({ linkId: "link-1" }));
const finishDeviceLink = mock(
  async (_input: { linkId: string; psk: Uint8Array }): Promise<{ userId: string }> => ({
    userId: "user-1",
  }),
);

const View = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
mock.module("expo-router", () => ({ router: { replace } }));
mock.module("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: createLink }),
  useQuery: (options: typeof queryOptions) => {
    queryOptions = options;
    return { data: statusData, isError: false };
  },
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("@openbeacon/encryption", () => ({
  createDeviceLinkSecret: () => new Uint8Array(32),
  formatDeviceLinkCode: () => "device-link-code",
}));
mock.module("expo-screen-capture", () => ({
  allowScreenCaptureAsync: async () => {},
  disableAppSwitcherProtectionAsync: async () => {},
  enableAppSwitcherProtectionAsync: async () => {},
  preventScreenCaptureAsync: async () => {},
}));
mock.module("react-native", () => ({ ScrollView: View, View }));
mock.module("react-native-qrcode-svg", () => ({ default: () => null }));
mock.module("react-native-safe-area-context", () => ({ SafeAreaView: View }));
mock.module("../components/headers/BackButton.tsx", () => ({ BackButton: () => null }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("mock-button", { onPress }, children),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: View }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    deviceLink: {
      create: { mutationOptions: () => ({}) },
      status: { queryOptions: () => ({}) },
    },
  },
}));
mock.module("../lib/deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({ publicKey: "device-public-key" }),
}));
mock.module("../lib/deviceLink.ts", () => ({ finishDeviceLink, HANDOVER_REJECTED_MESSAGE }));
mock.module("../lib/resealPersonalData.ts", () => ({ resealPersonalData: async () => {} }));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));

const { default: LinkWithOtherPhoneScreen } = await import("../app/setup/link.tsx");

let root: Root | null = null;

const render = async () => {
  root ??= createRoot();
  await act(async () => root?.render(<LinkWithOtherPhoneScreen />));
};

const rendered = () => JSON.stringify(root?.container.toJSON());

const pressButton = async (label: string) => {
  const button = root?.container
    .queryAll((item) => item.type === "mock-button")
    .find((item) => JSON.stringify(item.children).includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => (button.props as { onPress: () => void }).onPress());
};

beforeEach(() => {
  statusData = undefined;
  replace.mockClear();
  createLink.mockClear();
  finishDeviceLink.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("keeps polling every 2 seconds, even after a failed poll, until approved or expired", async () => {
  await render();
  const interval = (data: { state: string } | undefined) =>
    queryOptions.refetchInterval?.({ state: { data } });
  expect(interval(undefined)).toBe(2_000);
  expect(interval({ state: "waiting" })).toBe(2_000);
  expect(interval({ state: "approved" })).toBe(false);
  expect(interval({ state: "expired" })).toBe(false);
});

test("a network error after approval offers Try again with the same handover", async () => {
  finishDeviceLink.mockImplementationOnce(async () => {
    throw new TRPCClientError("Network request failed");
  });
  await render();
  statusData = approvedStatus;
  await render();

  expect(rendered()).toContain("We couldn’t reach your server");
  expect(rendered()).toContain("Try again");
  expect(rendered()).not.toContain("Continue");
  expect(queryOptions.enabled).toBe(false);

  await pressButton("Try again");

  expect(finishDeviceLink).toHaveBeenCalledTimes(2);
  const [first, second] = finishDeviceLink.mock.calls.map(([input]) => input);
  expect(second).toEqual(first);
  expect(first).toMatchObject({ linkId: "link-1", ciphertext: "ciphertext" });
  expect(createLink).toHaveBeenCalledTimes(1);
  expect(replace.mock.calls).toEqual([["/setup/name"]]);
});

test("a rejected handover only offers Continue", async () => {
  finishDeviceLink.mockImplementationOnce(async () => {
    throw new Error(HANDOVER_REJECTED_MESSAGE);
  });
  await render();
  statusData = approvedStatus;
  await render();

  expect(rendered()).toContain(HANDOVER_REJECTED_MESSAGE);
  expect(rendered()).not.toContain("Try again");
  await pressButton("Continue");
  expect(replace.mock.calls).toEqual([["/setup/name"]]);
});

test("a phone that's already set up is told so instead of being told the server is unreachable", async () => {
  createLink.mockImplementationOnce(async () => {
    throw TRPCClientError.from({
      error: { code: -32009, data: { code: "CONFLICT" }, message: "This phone is already set up." },
    });
  });
  await render();

  expect(rendered()).toContain("This phone is already set up.");
  expect(rendered()).not.toContain("couldn’t reach your server");
  await pressButton("Continue");
  expect(replace.mock.calls).toEqual([["/"]]);
});
