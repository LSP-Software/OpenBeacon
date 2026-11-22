import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";
import type { LiveMapMarker } from "../lib/buildLiveMapMarkers.ts";
import type { MapPeople } from "../lib/mapPeopleTypes.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mapProps: { markers: readonly LiveMapMarker[]; people: MapPeople | null } | null = null;
const passThrough = ({ children }: { children?: React.ReactNode }) =>
  React.createElement("view", null, children);

mock.module("@tanstack/react-query", () => ({
  keepPreviousData: <T,>(previous: T) => previous,
  queryOptions: <T,>(options: T) => options,
  skipToken: Symbol("skipToken"),
  useQuery: ({ queryKey }: { queryKey?: unknown[] }) => ({
    data:
      queryKey?.[0] === "registeredDevice"
        ? { deviceId: "my-phone", publicKey: "key", userId: "me" }
        : queryKey?.[0] === "trackingQueueEviction"
          ? null
          : [],
  }),
  useQueries: () => [],
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useMutation: () => ({ isPending: false, mutate: () => {} }),
}));
mock.module("../components/AnnouncementBanner.tsx", () => ({ AnnouncementBanner: () => null }));
mock.module("../components/NewSignInBanner.tsx", () => ({ NewSignInBanner: () => null }));
mock.module("../components/map/LocationSharingPausedBanner.tsx", () => ({
  LocationSharingPausedBanner: () => null,
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: passThrough }));
mock.module("../components/ui/Text.tsx", () => ({ Text: passThrough }));
mock.module("../components/map/NativeMap.tsx", () => ({
  NativeMap: (props: { markers: readonly LiveMapMarker[]; people: MapPeople | null }) => {
    mapProps = props;
    return null;
  },
}));
mock.module("../lib/tracking.ts", () => ({
  dismissTrackingQueueEviction: async () => {},
  getTrackingQueueEviction: async () => null,
}));
mock.module("../lib/placeSync.ts", () => ({
  confirmDeletePlace: () => {},
  groupPlacesQueryKey: (groupId: string) => ["groupPlaces", groupId],
  groupPlacesQueryOptions: () => ({ queryKey: ["groupPlaces"] }),
}));
mock.module("../lib/networkStatus.ts", () => ({ useOfflineStatus: () => false }));
mock.module("expo-router", () => ({
  Link: passThrough,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: () => {} }),
}));
mock.module("@react-navigation/native", () => ({ useIsFocused: () => true }));
mock.module("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
  ScrollView: passThrough,
  View: passThrough,
}));
mock.module("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
mock.module("../hooks/useGroupColorRevision.ts", () => ({ useGroupColorRevision: () => 0 }));
mock.module("../hooks/useGroupKeyAccess.ts", () => ({ useCurrentGroupKeyAccess: () => [] }));
mock.module("../hooks/useLiveTrackingPositions.ts", () => ({
  useLiveTrackingPositions: () => ({
    dropRemovedDevices: () => {},
    positions: [],
    status: { connection: "ok", groups: {}, membership: "loaded", undecryptable: [] },
  }),
}));
mock.module("../hooks/useTrackingUploadTime.ts", () => ({ useTrackingUploadTime: () => null }));
mock.module("../hooks/useSelfDeviceLocation.ts", () => ({
  useSelfDeviceLocation: () => ({
    latitude: 51.5,
    longitude: -0.12,
    timestamp: "2026-11-19T10:00:00.000Z",
  }),
}));
mock.module("../lib/api.ts", () => ({
  trpc: {
    auth: { providers: { queryOptions: () => ({}) } },
    groupMembership: {
      list: { queryOptions: () => ({}) },
      listMemberDevices: { queryOptions: () => ({}) },
    },
    groupTracking: { requestUpdate: { mutationOptions: () => ({}) } },
  },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "me", image: null, name: "Sam" } } }) },
}));
mock.module("../lib/groupColor.ts", () => ({ getGroupColor: () => "#FF1464" }));
mock.module("../lib/personalNicknames.ts", () => ({ loadPersonalNicknames: async () => ({}) }));
mock.module("../lib/storage.ts", () => ({
  storage: {
    getBoolean: () => undefined,
    getString: () => undefined,
    remove: () => {},
    set: () => {},
  },
}));
const { default: MapScreen } = await import("../app/(tabs)/map/index.tsx");

test("someone with no groups sees their own pin and no empty-state message", async () => {
  const root = createRoot();
  await act(async () => root.render(<MapScreen />));

  expect(mapProps?.markers).toMatchObject([
    {
      deviceId: "my-phone",
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      name: "Sam",
      userId: "me",
    },
  ]);
  expect(mapProps?.people?.upToDate.map((person) => person.userId)).toEqual(["me"]);
  expect(JSON.stringify(root.container.toJSON())).not.toContain("group");
  await act(async () => root.unmount());
});
