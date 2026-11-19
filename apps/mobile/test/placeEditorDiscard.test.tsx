import { beforeEach, expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type BeforeRemoveEvent = {
  data: { action: { type: string } };
  preventDefault: () => void;
};

let placeId: string | undefined;
let beforeRemove: ((event: BeforeRemoveEvent) => void) | null = null;
const dispatched: { type: string }[] = [];
const element =
  (type: string) =>
  ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement(type, props, children);

mock.module("@maplibre/maplibre-react-native", () => ({
  Camera: React.forwardRef(() => null),
  Map: element("map"),
}));
mock.module("expo-router", () => ({
  useLocalSearchParams: () => ({ groupId: "family", placeId }),
  useNavigation: () => navigation,
  useRouter: () => ({ back: () => {}, canGoBack: () => true, replace: () => {} }),
}));
const navigation = {
  addListener: (_event: "beforeRemove", listener: (event: BeforeRemoveEvent) => void) => {
    beforeRemove = listener;
    return () => {
      beforeRemove = null;
    };
  },
  dispatch: (action: { type: string }) => dispatched.push(action),
};
mock.module("lucide-react-native", () => ({ LocateFixedIcon: () => null, XIcon: () => null }));
mock.module("react-native", () => ({
  ActivityIndicator: element("activity-indicator"),
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  KeyboardAvoidingView: element("keyboard-avoiding-view"),
  Pressable: element("pressable"),
  TextInput: element("text-input"),
  View: element("view"),
}));
mock.module("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
mock.module("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        ciphertext: "cipher",
        emoji: "🏠",
        geometry: { latitude: 51.5, longitude: -0.12, radiusMeters: 150 },
        id: "home",
        name: "Home",
      },
    ],
    isError: false,
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
mock.module("../components/map/LiveMapBottomSheet.tsx", () => ({
  LiveMapBottomSheet: ({ children, header }: { children?: ReactNode; header: ReactNode }) =>
    React.createElement("sheet", null, header, children),
}));
mock.module("../components/map/PlacePin.tsx", () => ({ PlacePin: () => null }));
mock.module("../components/map/useNativeMapStyle.ts", () => ({
  useNativeMapStyle: () => ({ mapRevision: 0, mapStyle: { version: 8 } }),
}));
mock.module("../components/PlaceSizeSlider.tsx", () => ({
  PlaceSizeSlider: element("size-slider"),
}));
mock.module("../components/ui/Button.tsx", () => ({ Button: element("button") }));
mock.module("../components/ui/Icon.tsx", () => ({ Icon: () => null }));
mock.module("../components/ui/Text.tsx", () => ({ Text: element("text") }));
mock.module("../hooks/useCachedGroup.ts", () => ({
  useCachedGroup: () => ({
    group: { members: [{ role: "OWNER", userId: "me" }], name: "Family" },
    isError: false,
    isPending: false,
    refetch: async () => {},
  }),
}));
mock.module("../hooks/useSelfDeviceLocation.ts", () => ({ useSelfDeviceLocation: () => null }));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "me" } } }) },
}));
mock.module("../lib/placeSync.ts", () => ({
  confirmDeletePlace: () => {},
  groupPlacesQueryKey: () => ["groupPlaces"],
  groupPlacesQueryOptions: () => ({}),
  savePlace: async () => ({ place: { id: "home" } }),
}));
mock.module("../lib/placeBackgroundSync.ts", () => ({ syncGroupPlaces: async () => {} }));

const { getSnapshot } = await import("../lib/alert.ts");
const { default: PlaceScreen } = await import("../app/place.tsx");

const tryToLeave = () => {
  let prevented = false;
  act(() =>
    beforeRemove?.({
      data: { action: { type: "GO_BACK" } },
      preventDefault: () => {
        prevented = true;
      },
    }),
  );
  return prevented;
};

const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<PlaceScreen />));
  return root;
};

const latestAlert = () => getSnapshot().at(-1);

const setSize = async (root: ReturnType<typeof createRoot>, radiusMeters: number) => {
  const slider = root.container.queryAll((node) => node.type === "size-slider")[0];
  const onChange = slider?.props["onChange"];
  if (typeof onChange !== "function") throw new Error("Size slider not found");
  await act(async () => onChange(radiusMeters));
};

beforeEach(() => {
  dispatched.length = 0;
  placeId = undefined;
});

test("closing a new place that hasn't been touched doesn't ask", async () => {
  const root = await render();
  const alerts = getSnapshot().length;
  expect(tryToLeave()).toBe(false);
  expect(getSnapshot().length).toBe(alerts);
  await act(async () => root.unmount());
});

test("closing a new place after changing its size asks before discarding it", async () => {
  const root = await render();
  await setSize(root, 400);

  expect(tryToLeave()).toBe(true);
  const alert = latestAlert();
  expect(alert?.title).toBe("Discard this place?");
  expect(alert?.buttons.map(({ style, text }) => [text, style])).toEqual([
    ["Keep editing", "cancel"],
    ["Discard", "destructive"],
  ]);
  expect(dispatched).toEqual([]);

  act(() => alert?.buttons[1]?.onPress?.());
  expect(dispatched).toEqual([{ type: "GO_BACK" }]);
  await act(async () => root.unmount());
});

test("closing an existing place asks only once it has been changed", async () => {
  placeId = "home";
  const root = await render();
  expect(tryToLeave()).toBe(false);

  await setSize(root, 300);
  expect(tryToLeave()).toBe(true);
  expect(latestAlert()?.title).toBe("Discard this place?");

  await setSize(root, 150);
  expect(tryToLeave()).toBe(false);
  await act(async () => root.unmount());
});
