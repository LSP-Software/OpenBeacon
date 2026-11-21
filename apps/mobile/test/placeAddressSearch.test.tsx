import { beforeEach, expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";
import type { PlaceSearchBox, PlaceSearchOutcome } from "../modules/openbeacon-tracking/index.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let placeId: string | undefined;
let searchAvailable = true;
let searchOutcome: PlaceSearchOutcome = { status: "results", results: [] };
let heldSearch: (() => void) | null = null;
let holdSearches = false;
const searches: { box: PlaceSearchBox | null; query: string }[] = [];
const announcements: string[] = [];
const flights: { center: [number, number]; zoom: number }[] = [];
const saved: { geometry: { latitude: number; longitude: number } }[] = [];
const element =
  (type: string) =>
  ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement(type, props, children);

mock.module("@maplibre/maplibre-react-native", () => ({
  Camera: React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => ({
      flyTo: (options: { center: [number, number]; zoom: number }) => flights.push(options),
      jumpTo: () => {},
    }));
    return null;
  }),
  Map: element("map"),
}));
mock.module("expo-router", () => ({
  useLocalSearchParams: () => ({ groupId: "family", placeId }),
  useNavigation: () => ({ addListener: () => () => {}, dispatch: () => {} }),
  useRouter: () => ({ back: () => {}, canGoBack: () => true, replace: () => {} }),
}));
mock.module("lucide-react-native", () => ({
  LocateFixedIcon: () => null,
  SearchIcon: () => null,
  XIcon: () => null,
}));
mock.module("react-native", () => ({
  AccessibilityInfo: {
    announceForAccessibility: (message: string) => announcements.push(message),
  },
  ActivityIndicator: element("activity-indicator"),
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  KeyboardAvoidingView: element("keyboard-avoiding-view"),
  Platform: { OS: "android" },
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
  savePlace: async (input: { geometry: { latitude: number; longitude: number } }) => {
    saved.push(input);
    return { place: { id: "home" } };
  },
}));
mock.module("../lib/placeBackgroundSync.ts", () => ({ syncGroupPlaces: async () => {} }));
mock.module("../lib/trackingModule.ts", () => ({
  loadTrackingModule: async () => ({
    isPlaceSearchAvailable: () => searchAvailable,
    searchPlaces: async (query: string, box: PlaceSearchBox | null) => {
      searches.push({ box, query });
      if (holdSearches) await new Promise<void>((resolve) => (heldSearch = resolve));
      return searchOutcome;
    },
  }),
}));

const { default: PlaceScreen } = await import("../app/place.tsx");

const downingStreet = {
  addressLine: "10 Downing St, London SW1A 2AA, UK",
  houseNumber: "10",
  street: "Downing Street",
  subLocality: null,
  locality: null,
  postcode: "SW1A 2AA",
  countryCode: "GB",
  latitude: 51.5033395,
  longitude: -0.1275662,
};

const render = async () => {
  const root = createRoot();
  await act(async () => root.render(<PlaceScreen />));
  return root;
};

type Root = Awaited<ReturnType<typeof render>>;

const text = (root: Root) => JSON.stringify(root.container.toJSON());

const searchBar = (root: Root) => {
  const bar = root.container.queryAll(
    (node) =>
      node.type === "text-input" && node.props["accessibilityLabel"] === "Search for an address",
  )[0];
  if (!bar) throw new Error("Search bar not found");
  return bar;
};

const press = async (root: Root, label: string) => {
  const target = root.container.queryAll(
    (node) => node.type === "pressable" && node.props["accessibilityLabel"] === label,
  )[0];
  const onPress = target?.props["onPress"];
  if (typeof onPress !== "function") throw new Error(`${label} not found`);
  await act(async () => onPress());
};

const searchFor = async (root: Root, query: string) => {
  await act(async () => searchBar(root).props["onChangeText"](query));
  await act(async () => searchBar(root).props["onSubmitEditing"]());
};

const pressButton = async (root: Root, label: string) => {
  const button = root.container
    .queryAll((node) => node.type === "button")
    .find((node) => JSON.stringify(node.toJSON()).includes(label));
  await act(async () => button?.props["onPress"]());
};

const saveFromStepTwo = async (root: Root) => {
  await pressButton(root, "Next");
  await pressButton(root, "Save place");
};

beforeEach(() => {
  placeId = undefined;
  searchAvailable = true;
  searchOutcome = { status: "results", results: [] };
  searches.length = 0;
  flights.length = 0;
  announcements.length = 0;
  saved.length = 0;
  heldSearch = null;
  holdSearches = false;
});

test("a phone without an address lookup service shows the bar disabled with the reason", async () => {
  searchAvailable = false;
  const root = await render();

  expect(searchBar(root).props["editable"]).toBe(false);
  expect(searchBar(root).props["placeholder"]).toBe("Address search isn’t available on this phone");
  expect(text(root)).toContain(
    "Your phone has no address lookup service. Move the map to the spot instead.",
  );
  await act(async () => root.unmount());
});

test("the title moves into the sheet header on the first step", async () => {
  const root = await render();
  expect(text(root)).toContain("Add place to Family · Step 1 of 2");
  await act(async () => root.unmount());
});

test("a result moves the map there and says where it landed", async () => {
  searchOutcome = { status: "results", results: [downingStreet] };
  const root = await render();
  await searchFor(root, " 10 Downing Street, London ");

  expect(searches).toEqual([{ box: null, query: "10 Downing Street, London" }]);
  expect(flights).toHaveLength(1);
  expect(flights[0]?.center[0]).toBeCloseTo(-0.1275662, 6);
  expect(text(root)).toContain("10 Downing St, London SW1A 2AA");
  expect(text(root)).toContain("Move the map if it isn’t quite right.");
  expect(announcements).toEqual([
    "Moved to 10 Downing St, London SW1A 2AA, UK. Move the map if it isn’t quite right.",
  ]);
  await act(async () => root.unmount());
});

test("clearing the search keeps the pin where the search put it", async () => {
  placeId = "home";
  searchOutcome = { status: "results", results: [downingStreet] };
  const root = await render();
  await searchFor(root, "10 Downing Street, London");
  await press(root, "Clear search");

  expect(searchBar(root).props["value"]).toBe("");
  expect(flights).toHaveLength(1);
  await saveFromStepTwo(root);
  expect(saved[0]?.geometry.latitude).toBeCloseTo(51.5033395, 6);
  expect(saved[0]?.geometry.longitude).toBeCloseTo(-0.1275662, 6);
  await act(async () => root.unmount());
});

test("no matches and failed lookups say what to do instead", async () => {
  const root = await render();
  await searchFor(root, "asdkjhqwe");
  expect(text(root)).toContain("Couldn’t find that. Try a postcode, or move the map to the spot.");
  expect(flights).toHaveLength(0);

  searchOutcome = { status: "error", message: "Timed out." };
  await searchFor(root, "EN5 3DJ");
  expect(text(root)).toContain(
    "Search isn’t working right now. You can still move the map to the spot.",
  );
  await act(async () => root.unmount());
});

test("a result that arrives after moving on to naming the place is ignored", async () => {
  placeId = "home";
  holdSearches = true;
  searchOutcome = { status: "results", results: [downingStreet] };
  const root = await render();
  await searchFor(root, "10 Downing Street, London");
  await pressButton(root, "Next");
  await act(async () => heldSearch?.());

  expect(flights).toHaveLength(0);
  await pressButton(root, "Save place");
  expect(saved).toHaveLength(0);
  await act(async () => root.unmount());
});
