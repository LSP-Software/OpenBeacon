import { beforeEach, expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";
import type { GroupPlace } from "../lib/places.ts";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let role = "OWNER";
let places: GroupPlace[] = [];
let sharing = { enabled: true, arrivalsOff: [] as { userId: string; deviceId: string }[] };
let sharingFailed = false;
let placesFailedToRefresh = false;
let notificationRequests = 0;
let pendingSharingChange: { isPending: true; variables: { enabled: boolean } } | null = null;
const storedFlags = new Set<string>();
const passthrough = ({ children }: { children?: ReactNode }) =>
  React.createElement(React.Fragment, null, children);

mock.module("@tanstack/react-query", () => ({
  skipToken: Symbol("skipToken"),
  useMutation: () => pendingSharingChange ?? { isPending: false, mutateAsync: async () => ({}) },
  useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: () => {} }),
  useQuery: (options: { queryKey?: unknown[]; select?: (groups: unknown[]) => unknown }) => {
    const key = options.queryKey?.[0];
    if (key === "groupPlaces") {
      return { data: places, isPending: false, isError: placesFailedToRefresh };
    }
    if (key === "placeSharing") {
      return sharingFailed
        ? { data: undefined, isError: true, isFetching: false, refetch: async () => {} }
        : { data: sharing, isError: false };
    }
    if (key === "memberDevices") {
      return { data: [{ deviceId: "phone", name: "Pixel 8", userId: "self" }] };
    }
    if (key === "registeredDevice") return { data: { deviceId: "phone", userId: "self" } };
    return {
      data: options.select?.([
        { id: "family", members: [{ id: "m-self", role, userId: "self", name: "Me" }] },
      ]),
      isPending: false,
    };
  },
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("expo-router", () => ({ Link: passthrough }));
mock.module("react-native", () => createReactNativeTestModule());
mock.module("lucide-react-native", () => ({
  BellIcon: () => null,
  ChevronRightIcon: () => null,
  HourglassIcon: () => null,
  InfoIcon: () => null,
  MapPinIcon: () => null,
  PlusIcon: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: passthrough }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Switch.tsx", () => ({
  Switch: ({ value }: { value: boolean }) => `switch:${value ? "on" : "off"}`,
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: passthrough }));
mock.module("../components/LoadingIndicator.tsx", () => ({ LoadingIndicator: () => null }));
mock.module("../lib/api.ts", () => ({
  trpc: {
    groupMembership: {
      list: { queryOptions: () => ({}) },
      listMemberDevices: { queryOptions: () => ({ queryKey: ["memberDevices"] }) },
    },
    placeSharing: {
      get: { queryOptions: () => ({ queryKey: ["placeSharing"] }) },
      set: { mutationOptions: () => ({}) },
    },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "self" } } }) },
}));
mock.module("../hooks/useMemberNames.ts", () => ({
  useMemberNameList: () => (userId: string) => (userId === "sam" ? ["Sam"] : []),
  useMemberNames: () => (userId: string) => (userId === "sam" ? "Sam" : null),
}));
mock.module("../lib/registeredDevice.ts", () => ({
  registeredDeviceQueryOptions: (userId: string) => ({ queryKey: ["registeredDevice", userId] }),
}));
mock.module("../lib/placeCatchUp.ts", () => ({ catchUpGroupPlaces: async () => 0 }));
mock.module("../lib/placeBackgroundSync.ts", () => ({
  markPlacesUnsynced: () => {},
  syncGroupPlaces: async () => true,
}));
mock.module("../lib/notifications.ts", () => ({
  requestNotificationPermissions: async () => {
    notificationRequests += 1;
    return "granted";
  },
}));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => storedFlags.has(key),
    set: (key: string) => {
      storedFlags.add(key);
    },
  },
}));
mock.module("../lib/placeSync.ts", () => ({
  groupPlacesQueryKey: (groupId: string) => ["groupPlaces", groupId],
  groupPlacesQueryOptions: () => ({ queryKey: ["groupPlaces"] }),
}));

const { default: PlacesTab } = await import("../components/groups/PlacesTab.tsx");

const place = (overrides: Partial<GroupPlace>): GroupPlace => ({
  algorithm: "xchacha20poly1305",
  ciphertext: "cipher",
  createdAt: new Date(0),
  createdByUserId: "self",
  emoji: "🏠",
  epochId: "epoch",
  geometry: { v: 1, latitude: 51.5, longitude: -0.12, radiusMeters: 250 },
  id: "home",
  kind: "placeGeometry",
  name: "Home",
  nonce: "nonce",
  senderDeviceId: "phone",
  updatedAt: new Date(0),
  updatedByUserId: null,
  ...overrides,
});

const render = async () => {
  const root = createRoot();
  await act(async () =>
    root.render(
      <PlacesTab
        groupId="family"
        groupName="Family"
        livePositions={[
          {
            battery: { charging: false, level: 80 },
            deviceId: "sams-phone",
            latitude: 51.5001,
            longitude: -0.12,
            sourceGroupId: "family",
            speed: null,
            timestamp: new Date().toISOString(),
            userId: "sam",
          },
        ]}
      />,
    ),
  );
  return JSON.stringify(root.container.toJSON());
};

beforeEach(() => {
  role = "OWNER";
  sharing = { enabled: true, arrivalsOff: [] };
  sharingFailed = false;
  placesFailedToRefresh = false;
  notificationRequests = 0;
  pendingSharingChange = null;
  storedFlags.clear();
  places = [place({}), place({ id: "club", name: "Football club", emoji: "⚽", geometry: null })];
});

test("shows each place with its size and who's here, and places still syncing", async () => {
  const text = await render();
  expect(text).toContain("Medium · 250 m");
  expect(text).toContain("Sam is here");
  expect(text).toContain("Football club");
  expect(text).toContain("Syncing, this can take a few minutes");
  expect(text).toContain("switch:on");
});

test("only owners and admins can add places", async () => {
  expect(await render()).toContain("Add place");
  role = "ADMIN";
  expect(await render()).toContain("Add place");
  role = "MEMBER";
  const memberView = await render();
  expect(memberView).not.toContain("Add place");
  expect(memberView).toContain("Home");
});

test("the empty state only offers adding a place to admins", async () => {
  places = [];
  expect(await render()).toContain("Add your first place");
  role = "MEMBER";
  const memberView = await render();
  expect(memberView).toContain("No places yet");
  expect(memberView).not.toContain("Add place");
});

test("says when this phone's arrivals and departures are off", async () => {
  sharing = { enabled: false, arrivalsOff: [{ userId: "self", deviceId: "phone" }] };
  const text = await render();
  expect(text).toContain("Arrivals and departures are off on this phone");
  expect(text).toContain("your Pixel 8");
  expect(text).toContain("switch:off");
});

test("keeps the arrivals switch reachable with no places while it's off on this phone", async () => {
  places = [];
  expect(await render()).not.toContain("switch:");
  sharing = { enabled: false, arrivalsOff: [{ userId: "self", deviceId: "phone" }] };
  const text = await render();
  expect(text).toContain("Arrivals and departures are off on this phone");
  expect(text).toContain("switch:off");
});

test("offers a retry when the arrivals setting can't be loaded", async () => {
  sharingFailed = true;
  const text = await render();
  expect(text).toContain("Couldn’t load this setting.");
  expect(text).toContain("Try again");
  expect(text).not.toContain("switch:");
});

test("asks for notification permission the first time Places opens, and only then", async () => {
  await render();
  await render();
  expect(notificationRequests).toBe(1);
});

test("a failed background refresh keeps the loaded places", async () => {
  placesFailedToRefresh = true;
  const text = await render();
  expect(text).toContain("Home");
  expect(text).not.toContain("Couldn’t load places");
});

test("the arrivals switch shows the new value while the change is being saved", async () => {
  pendingSharingChange = { isPending: true, variables: { enabled: false } };
  expect(await render()).toContain("switch:off");
});
