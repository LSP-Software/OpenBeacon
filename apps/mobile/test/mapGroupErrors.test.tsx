import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let groups: { id: string; name: string; members: never[] }[] = [];
let access: {
  data: {
    current: "available" | "missing" | "unavailable";
    history: "complete" | { partialFrom: Date };
  };
}[] = [];
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
mock.module("react-native", () => ({
  View: ({ children }: { children: React.ReactNode }) =>
    React.createElement("view", null, children),
  ScrollView: ({ children }: { children: React.ReactNode }) =>
    React.createElement("scroll", null, children),
}));
mock.module("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
mock.module("../components/map/NativeMap.tsx", () => ({ NativeMap: () => null }));
mock.module("../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));
mock.module("../hooks/useGroupColorRevision.ts", () => ({ useGroupColorRevision: () => 0 }));
mock.module("../hooks/useGroupKeyAccess.ts", () => ({ useCurrentGroupKeyAccess: () => access }));
mock.module("../hooks/useMapLivePositions.ts", () => ({
  useMapLivePositions: () => ({
    positions: [],
    status: { groups: {}, membership: "loading", undecryptable: [] },
  }),
}));
mock.module("../hooks/useMembershipSnapshot.ts", () => ({ useMembershipSnapshot: () => groups }));
mock.module("../hooks/useTrackingUploadTime.ts", () => ({ useTrackingUploadTime: () => null }));
mock.module("../hooks/useSelfDeviceLocation.ts", () => ({ useSelfDeviceLocation: () => null }));
mock.module("../lib/api.ts", () => ({
  trpc: { groupMembership: { list: { queryOptions: () => ({}) } } },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: null }) },
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
mock.module("../lib/storage.ts", () => ({
  storage: { getBoolean: () => undefined, set: () => {} },
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
      { data: { current: count > 0 ? "missing" : "available", history: "complete" } },
      { data: { current: "available", history: partial } },
      { data: { current: count > 1 ? "missing" : "available", history: partial } },
      { data: { current: count > 2 ? "missing" : "available", history: "complete" } },
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
