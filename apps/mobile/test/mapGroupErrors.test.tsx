import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import type { MapPeople } from "../lib/mapPeopleTypes.ts";
import type { MapTrackingStatus } from "../lib/mapTrackingTypes.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let groups: {
  id: string;
  name: string;
  members: { id: string; image: null; name: string; userId: string }[];
}[] = [];
let access: (
  | {
      data: {
        current: "available" | "missing" | "unavailable";
        history: "complete" | { partialFrom: Date };
      };
      isError: false;
    }
  | { data: undefined; isError: true }
)[] = [];
let sessionUser: { id: string; image: null; name: string } | null = null;
let trackingStatus: MapTrackingStatus = {
  connection: "ok",
  groups: {},
  membership: "loading",
  undecryptable: [],
};
let mapProps: { people: MapPeople | null } | null = null;
let queueEviction: {
  owner: string;
  pointCount: number;
  oldestQueuedAt: number;
  newestQueuedAt: number;
  revision: number;
} | null = null;
const dismissedEvictions: unknown[] = [];
mock.module("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey?: unknown[] }) => ({
    data: queryKey?.[0] === "trackingQueueEviction" ? queueEviction : groups,
  }),
  useQueries: () => [],
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useMutation: () => ({
    isPending: false,
    mutate: (variables: unknown) => dismissedEvictions.push(variables),
  }),
}));
mock.module("../lib/tracking.ts", () => ({
  dismissTrackingQueueEviction: async () => {},
  getTrackingQueueEviction: async () => queueEviction,
}));
mock.module("../components/ui/Button.tsx", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) =>
    React.createElement("pressable", { onPress }, children),
}));
mock.module("expo-router", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: unknown }) =>
    React.createElement("a", { href }, children),
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
  View: ({ children }: { children: React.ReactNode }) =>
    React.createElement("view", null, children),
  ScrollView: ({ children }: { children: React.ReactNode }) =>
    React.createElement("scroll", null, children),
}));
mock.module("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
mock.module("../components/map/NativeMap.tsx", () => ({
  NativeMap: (props: { people: MapPeople | null }) => {
    mapProps = props;
    return null;
  },
}));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));
mock.module("../hooks/useGroupColorRevision.ts", () => ({ useGroupColorRevision: () => 0 }));
mock.module("../hooks/useGroupKeyAccess.ts", () => ({ useCurrentGroupKeyAccess: () => access }));
mock.module("../hooks/useMapLivePositions.ts", () => ({
  useMapLivePositions: () => ({ positions: [], status: trackingStatus }),
}));
mock.module("../hooks/useMembershipSnapshot.ts", () => ({ useMembershipSnapshot: () => groups }));
mock.module("../hooks/useTrackingUploadTime.ts", () => ({ useTrackingUploadTime: () => null }));
mock.module("../hooks/useSelfDeviceLocation.ts", () => ({ useSelfDeviceLocation: () => null }));
mock.module("../lib/api.ts", () => ({
  trpc: { groupMembership: { list: { queryOptions: () => ({}) } } },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: sessionUser ? { user: sessionUser } : null }) },
}));
mock.module("../lib/resolveSelfDeviceLocationFallback.ts", () => ({
  resolveSelfDeviceLocationFallback: () => null,
}));
mock.module("../lib/applySelfDeviceLocation.ts", () => ({ applySelfDeviceLocation: () => [] }));
mock.module("../lib/buildLiveMapMarkers.ts", () => ({
  buildLiveMapMarkers: () => [],
  initialsFromName: () => "??",
}));
mock.module("../lib/personalNicknames.ts", () => ({ loadPersonalNicknames: async () => ({}) }));
mock.module("../lib/groupColor.ts", () => ({ getGroupColor: () => "red" }));
const stored = new Map<string, boolean>();
mock.module("../lib/storage.ts", () => ({
  storage: {
    getBoolean: (key: string) => stored.get(key),
    remove: (key: string) => stored.delete(key),
    set: (key: string, value: boolean) => stored.set(key, value),
  },
}));
const { default: MapScreen } = await import("../app/(tabs)/map/index.tsx");

test("shows individual group links for up to two missing keys and a groups link above that", async () => {
  groups = ["One", "Healthy", "Two", "Three"].map((name, index) => ({
    id: `${index}`,
    name,
    members: [],
  }));
  const root = createRoot();
  for (const count of [0, 1, 2, 3]) {
    const partial = { partialFrom: new Date(0) };
    access = [
      {
        data: { current: count > 0 ? "missing" : "available", history: "complete" },
        isError: false,
      },
      { data: { current: "available", history: partial }, isError: false },
      {
        data: { current: count > 1 ? "missing" : "available", history: partial },
        isError: false,
      },
      {
        data: { current: count > 2 ? "missing" : "available", history: "complete" },
        isError: false,
      },
    ];
    await act(async () => root.render(<MapScreen />));
    const rendered = JSON.stringify(root.container.toJSON());
    expect(rendered.includes("Multiple groups require attention")).toBe(count > 2);
    expect(rendered.includes("Can’t show locations for")).toBe(count > 0 && count <= 2);
    expect(rendered.includes("Healthy")).toBe(false);
    if (count === 2) {
      expect(rendered).toContain('"groupId":"0"');
      expect(rendered).toContain('"groupId":"2"');
    }
    if (count === 3) expect(rendered).toContain("/(tabs)/groups");
  }
  await act(async () => root.unmount());
});

test("hides a dismissed key banner until that group's key works again", async () => {
  groups = [{ id: "club", name: "Club", members: [] }];
  sessionUser = { id: "me", image: null, name: "Me" };
  queueEviction = null;
  const missing = [{ data: { current: "missing", history: "complete" }, isError: false }] as const;
  access = [...missing];
  const root = createRoot();
  await act(async () => root.render(<MapScreen />));
  expect(JSON.stringify(root.container.toJSON())).toContain("Can’t show locations for");

  const dismiss = root.container.queryAll((item) => item.type === "pressable").at(-1);
  if (!dismiss) throw new Error("Dismiss button not found");
  await act(async () => (dismiss.props as { onPress: () => void }).onPress());
  expect(JSON.stringify(root.container.toJSON())).not.toContain("Can’t show locations for");

  await act(async () => root.render(<MapScreen />));
  expect(JSON.stringify(root.container.toJSON())).not.toContain("Can’t show locations for");

  access = [{ data: { current: "available", history: "complete" }, isError: false }];
  await act(async () => root.render(<MapScreen />));
  access = [...missing];
  await act(async () => root.render(<MapScreen />));
  expect(JSON.stringify(root.container.toJSON())).toContain("Can’t show locations for");
  await act(async () => root.unmount());
  stored.clear();
});

test("shows removed offline history until the user dismisses it", async () => {
  groups = [];
  access = [];
  queueEviction = null;
  const root = createRoot();
  await act(async () => root.render(<MapScreen />));
  expect(JSON.stringify(root.container.toJSON())).not.toContain("location history was removed");

  queueEviction = {
    owner: "owner",
    pointCount: 12,
    oldestQueuedAt: Date.UTC(2026, 10, 3, 14),
    newestQueuedAt: Date.UTC(2026, 10, 4, 9),
    revision: 5,
  };
  await act(async () => root.render(<MapScreen />));
  const rendered = JSON.stringify(root.container.toJSON());
  expect(rendered).toContain("Some location history was removed");
  expect(rendered).toContain("2026");

  const [dismiss] = root.container.queryAll((item) => item.type === "pressable");
  if (!dismiss) throw new Error("Dismiss button not found");
  await act(async () => (dismiss.props as { onPress: () => void }).onPress());
  expect(dismissedEvictions).toEqual([queueEviction]);
  await act(async () => root.unmount());
});

test("keeps members waiting instead of missing when their group's key check errored", async () => {
  const member = (id: string) => ({ id, image: null, name: id, userId: id });
  groups = [
    { id: "family", name: "Family", members: [member("me"), member("mum")] },
    { id: "club", name: "Club", members: [member("me"), member("josh")] },
  ];
  access = [
    { data: { current: "available", history: "complete" }, isError: false },
    { data: undefined, isError: true },
  ];
  sessionUser = { id: "me", image: null, name: "Me" };
  trackingStatus = {
    connection: "ok",
    groups: { family: "loaded", club: "loaded" },
    membership: "loaded",
    undecryptable: [],
  };
  const root = createRoot();
  await act(async () => root.render(<MapScreen />));

  const people = mapProps?.people;
  expect(people?.waiting.map(({ userId }) => userId)).toEqual(["me", "josh"]);
  expect(people?.cantLocate.map(({ userId }) => userId)).toEqual(["mum"]);
  expect(people?.cantRead).toEqual([]);
  await act(async () => root.unmount());
});
