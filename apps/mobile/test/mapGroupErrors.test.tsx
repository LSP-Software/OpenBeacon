import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let groups: { id: string; name: string }[] = [];
let access: { data: string }[] = [];
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({ data: groups }) }));
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
mock.module("../hooks/useGroupKeyAccess.ts", () => ({ useGroupKeyAccess: () => access }));
mock.module("../hooks/useMapLivePositions.ts", () => ({ useMapLivePositions: () => [] }));
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
mock.module("../lib/buildLiveMapMarkers.ts", () => ({ buildLiveMapMarkers: () => [] }));
mock.module("../lib/groupColor.ts", () => ({ getGroupColor: () => "red" }));
const { default: MapScreen } = await import("../app/(tabs)/map/index.tsx");

test("shows individual group links for up to two missing keys and a groups link above that", async () => {
  groups = ["One", "Healthy", "Two", "Three"].map((name, index) => ({ id: `${index}`, name }));
  const root = createRoot();
  for (const count of [0, 1, 2, 3]) {
    access = [
      { data: count > 0 ? "missing" : "available" },
      { data: "available" },
      { data: count > 1 ? "missing" : "available" },
      { data: count > 2 ? "missing" : "available" },
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
