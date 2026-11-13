import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { resolveLocationSharing, type SharingPreference } from "@openbeacon/shared";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const stored = new Map<string, string>();
const nativePauses: boolean[] = [];
const sentChanges: unknown[] = [];
let knownOffline = false;
let sharingQueryFails = false;
let releaseRequest: (() => void) | null = null;
let root: Root | null = null;
let queryClient: QueryClient;
const preference: SharingPreference = {
  sharingPaused: false,
  sharingPausedUntil: null,
  sharingChangedAt: null,
  sharingRevision: 0,
};
let serverAccount = preference;
const sharingState = () => ({
  account: serverAccount,
  device: preference,
  deviceId: "phone",
  userId: "alex",
  serverTime: new Date(),
  ...resolveLocationSharing(serverAccount, preference, Date.now()),
});
const Host = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
  React.createElement("host", props, children);
mock.module("react-native", () => ({
  Platform: { OS: "android" },
  View: Host,
  ScrollView: Host,
  Pressable: Host,
  Modal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? children : null,
}));
mock.module("lucide-react-native", () => ({ MapPinIcon: () => null, PauseIcon: () => null }));
mock.module("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    account: {
      locationSharing: {
        queryOptions: () => ({
          queryKey: ["sharing"],
          queryFn: async () => {
            if (sharingQueryFails) throw new Error("Server unavailable");
            return sharingState();
          },
        }),
        queryKey: () => ["sharing"],
      },
      listDevices: { queryKey: () => ["devices"] },
    },
  },
  trpcClient: {
    account: {
      locationSharing: { query: async () => sharingState() },
      setLocationSharing: {
        mutate: async (input: unknown) => {
          sentChanges.push(input);
          await new Promise<void>((resolve) => {
            releaseRequest = resolve;
          });
          return { status: "applied" };
        },
      },
    },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "alex" } } }) },
}));
mock.module("../lib/currentServer.ts", () => ({ baseUrl: "https://server.test" }));
mock.module("../lib/deviceKeys.ts", () => ({
  getStoredDeviceId: () => "phone",
  getRegisteredDeviceKey: async () => ({ userId: "alex", deviceId: "phone" }),
}));
mock.module("../lib/networkStatus.ts", () => ({ isDeviceOffline: async () => knownOffline }));
mock.module("../lib/trackingEvents.ts", () => ({ requestTrackingSync: () => {} }));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getAllKeys: () => [...stored.keys()],
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => stored.set(key, value),
    remove: (key: string) => stored.delete(key),
  },
}));
mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    setSharingState: (_owner: string, _deviceId: string, _prefix: string, paused: boolean) => {
      nativePauses.push(paused);
      return true;
    },
  },
}));
mock.module("./ui/Button.tsx", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("mock-button", props, children),
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
const { syncLocationSharing } = await import("../lib/locationSharing.ts");

const render = async () => {
  root = createRoot();
  await act(async () =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <LocationSharingCard />
      </QueryClientProvider>,
    ),
  );
};
const output = () => JSON.stringify(root?.container.toJSON());
const press = async (label: string) => {
  const button = root?.container
    .queryAll((node) => node.type === "mock-button")
    .findLast((node) => JSON.stringify(node.children).includes(label));
  const onPress = button?.props["onPress"];
  if (typeof onPress !== "function") throw new Error(`Missing button ${label}`);
  if (button?.props["disabled"] === true) throw new Error(`${label} is disabled`);
  await act(async () => {
    onPress();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};

beforeEach(() => {
  stored.clear();
  nativePauses.length = 0;
  sentChanges.length = 0;
  knownOffline = false;
  sharingQueryFails = false;
  serverAccount = preference;
  releaseRequest = null;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["sharing"], sharingState());
});
afterEach(async () => {
  releaseRequest?.();
  await act(async () => root?.unmount());
  root = null;
  queryClient.clear();
  onlineManager.setOnline(true);
});

test("an offline pause stops this phone before the connection returns and closes the sheet", async () => {
  knownOffline = true;
  onlineManager.setOnline(false);
  await render();
  await press("Pause sharing");
  expect(output()).toContain("Pause on");
  await press("Pause sharing");

  expect(nativePauses).toEqual([true]);
  expect([...stored.keys()].some((key) => key.startsWith("locationSharing.pending."))).toBe(true);
  expect(sentChanges).toHaveLength(0);
  expect(output()).not.toContain("Pause on");
  expect(output()).toContain("Sharing stopped on this phone.");
});

test("a pause waiting on a slow server can still be dismissed and keeps the phone paused", async () => {
  await render();
  await press("Pause sharing");
  await press("Pause sharing");
  expect(sentChanges).toHaveLength(1);
  expect(nativePauses).toEqual([true]);

  await press("Cancel");
  expect(output()).not.toContain("Pause on");
  expect(nativePauses).toEqual([true]);
});

test("a pause that reaches the server in the background shows on the card while its own query is failing", async () => {
  sharingQueryFails = true;
  await render();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(output()).toContain("Couldn’t check sharing status");

  serverAccount = { ...preference, sharingPaused: true, sharingRevision: 1 };
  await act(async () => {
    await syncLocationSharing();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  expect(output()).toContain("Paused on all your devices");
  expect(output()).not.toContain("Couldn’t check sharing status");
});
