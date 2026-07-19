import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { nextMapMarkerSelection } from "../../lib/mapMarkerSelection.ts";
import { createReactNativeTestModule } from "../../test/reactNativeTestModule.ts";
import {
  createLiveMapMarkerFixture,
  createMapLibreMockModule,
  emitNativeMapAndroidMarkerTap,
  emitNativeMapAnnotationDeselected,
  emitNativeMapAnnotationSelected,
  emitNativeMapDidFailLoadingMap,
  emitNativeMapDidFinishLoadingStyle,
  emitNativeMapPress,
  getNativeMapAnnotationMountCount,
  getNativeMapAnnotationRefreshCalls,
  getNativeMapAnnotationSelectedProp,
  getNativeMapCameraCommands,
  getNativeMapMountedAnnotationIds,
  getNativeMapSelfHeadingDegrees,
  getNativeMapStyle,
  getNativeMapViewMountCount,
  resetNativeMapHarness,
  setNativeMapSelfHeadingDegrees,
} from "./nativeMapTestHarness.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let currentSignedPmtilesUrlQuery: {
  data?: {
    expiresAt: string;
    refreshAt: string;
    url: string;
  } | null;
  error?: {
    data?: {
      code?: string;
    };
  } | null;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => Promise<void>;
};
let forceRefreshMutationCalls = 0;
let forceRefreshMutationPending = false;
let forceRefreshMutationSucceeds = true;
const setQueryData = mock(() => {});
const routerReplace = mock(() => {});
let root: Root | null = null;

mock.module("react-native", () => createReactNativeTestModule({ platformOS: "android" }));

mock.module("lucide-react-native", () => ({
  ScanIcon: () => React.createElement("scan-icon"),
}));

mock.module("../ui/Icon.tsx", () => ({
  Icon: () => React.createElement("icon"),
}));

mock.module("@tanstack/react-query", () => ({
  useMutation: (options: { onSuccess?: (data: unknown) => void }) => ({
    isPending: forceRefreshMutationPending,
    mutate: () => {
      forceRefreshMutationCalls += 1;
      if (!forceRefreshMutationSucceeds) {
        return;
      }

      options.onSuccess?.({
        expiresAt: "2026-03-31T12:20:00.000Z",
        refreshAt: "2026-03-31T12:19:00.000Z",
        url: "https://forced.example/pmtiles",
      });
    },
  }),
  useQuery: () => currentSignedPmtilesUrlQuery,
}));

mock.module("@maplibre/maplibre-react-native", createMapLibreMockModule);

mock.module("expo-router", () => ({
  router: {
    replace: routerReplace,
  },
  useRootNavigationState: () => ({
    key: "root",
  }),
}));

mock.module("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  }),
}));

mock.module("../../components/ui/Text.tsx", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("text", null, children),
}));

mock.module("../../hooks/useSignedPmtilesUrl.ts", () => ({
  useSignedPmtilesUrl: () => currentSignedPmtilesUrlQuery,
}));

mock.module("../../hooks/useSelfDeviceHeading.ts", () => ({
  useSelfDeviceHeading: () => getNativeMapSelfHeadingDegrees(),
}));

mock.module("../../lib/api.ts", () => ({
  queryClient: {
    setQueryData,
  },
  trpc: {
    maps: {
      forceRefreshSignedPmtilesUrl: {
        mutationOptions: () => ({}),
      },
      getSignedPmtilesUrl: {
        queryKey: () => [["maps", "getSignedPmtilesUrl"]],
      },
    },
  },
}));

mock.module("../../lib/protomaps-style.ts", () => ({
  getProtomapsMapStyle: (_theme: "light" | "dark", pmtilesUrl: string) => ({
    pmtilesUrl,
    version: 8,
  }),
}));

mock.module("../../providers/ThemeProvider.tsx", () => ({
  useTheme: () => ({
    mapTheme: "light" as const,
  }),
}));

mock.module("./LiveMapPersonSheet.tsx", () => ({
  LiveMapPersonSheet: ({ name }: { name: string }) =>
    React.createElement("live-map-person-sheet", { name }),
}));

mock.module("./LiveMapMarkerPin.tsx", () => ({
  LiveMapMarkerPin: ({ onBitmapContentChange }: { onBitmapContentChange?: () => void }) => {
    if (onBitmapContentChange) {
      (
        globalThis as typeof globalThis & { __nativeMapPinBitmapContentChange?: () => void }
      ).__nativeMapPinBitmapContentChange = onBitmapContentChange;
    }

    return React.createElement("live-map-marker-pin");
  },
}));

const { NativeMap }: typeof import("./NativeMap.tsx") = await import("./NativeMap.tsx");

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderNativeMap = async (
  props: {
    markers?: readonly LiveMapMarker[];
    onSelectUserId?: (userId: string | null) => void;
    selectedUserId?: string | null;
  } = {},
) => {
  if (!root) {
    root = createRoot();
  }

  await act(async () => {
    root?.render(<NativeMap {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderSelectableNativeMap = async (
  markers: readonly LiveMapMarker[],
  selectionHistory: Array<string | null>,
) => {
  if (!root) {
    root = createRoot();
  }

  const SelectableNativeMap = () => {
    const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
    const selectedUserIdRef = React.useRef<string | null>(null);

    return (
      <NativeMap
        markers={markers}
        selectedUserId={selectedUserId}
        onSelectUserId={(userId) => {
          const next = nextMapMarkerSelection(selectedUserIdRef.current, userId);
          selectedUserIdRef.current = next;
          selectionHistory.push(next);
          setSelectedUserId(next);
        }}
      />
    );
  };

  await act(async () => {
    root?.render(<SelectableNativeMap />);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const defaultSignedUrl = {
  expiresAt: "2026-03-31T12:10:00.000Z",
  refreshAt: "2026-03-31T12:09:00.000Z",
  url: "https://cached.example/pmtiles-1",
};

describe("NativeMap integration harness", () => {
  beforeEach(() => {
    resetNativeMapHarness();
    currentSignedPmtilesUrlQuery = {
      data: defaultSignedUrl,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: async () => {},
    };
    forceRefreshMutationCalls = 0;
    forceRefreshMutationPending = false;
    forceRefreshMutationSucceeds = true;
    setQueryData.mockReset();
    routerReplace.mockReset();
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
      root = null;
    }
  });

  test("redirects home when the signed pmtiles url query is unauthorized", async () => {
    currentSignedPmtilesUrlQuery = {
      data: null,
      error: {
        data: {
          code: "UNAUTHORIZED",
        },
      },
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: async () => {},
    };

    await renderNativeMap();
    await flushEffects();

    expect(routerReplace).toHaveBeenCalledWith("/");
  });

  test("forces one refresh per url after map failures and resets when the url changes", async () => {
    await renderNativeMap();

    emitNativeMapDidFailLoadingMap();
    emitNativeMapDidFailLoadingMap();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(setQueryData).toHaveBeenCalledWith(
      [["maps", "getSignedPmtilesUrl"]],
      expect.objectContaining({
        url: "https://forced.example/pmtiles",
      }),
    );

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        expiresAt: "2026-03-31T12:30:00.000Z",
        refreshAt: "2026-03-31T12:29:00.000Z",
        url: "https://cached.example/pmtiles-2",
      },
    };

    await renderNativeMap();
    emitNativeMapDidFailLoadingMap();

    expect(forceRefreshMutationCalls).toBe(2);
  });

  test("does not force refresh while a force-refresh mutation is already pending", async () => {
    forceRefreshMutationPending = true;
    await renderNativeMap();

    emitNativeMapDidFailLoadingMap();

    expect(forceRefreshMutationCalls).toBe(0);
  });

  test("keeps the retry gate consumed when force refresh fails without a new url", async () => {
    forceRefreshMutationSucceeds = false;
    await renderNativeMap();

    emitNativeMapDidFailLoadingMap();
    emitNativeMapDidFailLoadingMap();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(setQueryData).not.toHaveBeenCalled();
  });

  test("resets the failure retry gate after the style finishes loading", async () => {
    await renderNativeMap();

    emitNativeMapDidFailLoadingMap();
    expect(forceRefreshMutationCalls).toBe(1);

    emitNativeMapDidFinishLoadingStyle();
    emitNativeMapDidFailLoadingMap();

    expect(forceRefreshMutationCalls).toBe(2);
  });

  test("captures camera fit for the initial marker cohort and follow stops for selection", async () => {
    const alice = createLiveMapMarkerFixture({
      initials: "AL",
      latitude: 51.5,
      longitude: -0.12,
      name: "Alice",
      userId: "alice",
    });
    const bob = createLiveMapMarkerFixture({
      initials: "BO",
      latitude: 50.8,
      longitude: -1.1,
      name: "Bob",
      userId: "bob",
    });

    await renderNativeMap({ markers: [alice, bob] });
    await flushEffects();

    expect(getNativeMapCameraCommands().some((command) => command.type === "fitBounds")).toBe(true);

    await renderNativeMap({
      markers: [alice, bob],
      selectedUserId: "alice",
    });
    await flushEffects();

    const followStops = getNativeMapCameraCommands().filter(
      (command) =>
        command.type === "setCamera" &&
        typeof command.stop === "object" &&
        command.stop !== null &&
        "zoomLevel" in command.stop,
    );
    expect(followStops.length).toBeGreaterThan(0);
    expect(
      followStops.some(
        (command) =>
          command.type === "setCamera" &&
          (command.stop as { centerCoordinate: [number, number] }).centerCoordinate[0] === -0.12,
      ),
    ).toBe(true);
  });

  test("drives annotation select and map-background press through NativeMap", async () => {
    const selections: Array<string | null> = [];
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const bob = createLiveMapMarkerFixture({
      initials: "BO",
      name: "Bob",
      userId: "bob",
    });

    await renderNativeMap({
      markers: [alice, bob],
      onSelectUserId: (userId) => {
        selections.push(userId);
      },
    });

    expect(getNativeMapMountedAnnotationIds().sort()).toEqual(["alice", "bob"]);

    emitNativeMapAnnotationSelected("alice");
    emitNativeMapPress();
    emitNativeMapAnnotationSelected("bob");

    expect(selections).toEqual(["alice", null, "bob"]);
  });

  test("clears selection when Android emits annotation deselect", async () => {
    const selections: Array<string | null> = [];
    const alice = createLiveMapMarkerFixture({ userId: "alice" });

    await renderNativeMap({
      markers: [alice],
      onSelectUserId: (userId) => {
        selections.push(userId);
      },
      selectedUserId: "alice",
    });

    emitNativeMapAnnotationDeselected("alice");
    await flushEffects();

    expect(selections).toEqual([null]);
  });

  test("Android marker taps select, toggle off once, and switch people without extra taps", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const bob = createLiveMapMarkerFixture({
      initials: "BO",
      name: "Bob",
      userId: "bob",
    });
    const selectionHistory: Array<string | null> = [];

    await renderSelectableNativeMap([alice, bob], selectionHistory);

    await act(async () => {
      emitNativeMapAndroidMarkerTap("alice");
      await Promise.resolve();
    });
    await flushEffects();
    expect(selectionHistory).toEqual(["alice"]);

    await act(async () => {
      emitNativeMapAndroidMarkerTap("alice");
      await Promise.resolve();
    });
    await flushEffects();
    expect(selectionHistory).toEqual(["alice", null]);

    await act(async () => {
      emitNativeMapAndroidMarkerTap("alice");
      await Promise.resolve();
    });
    await flushEffects();
    expect(selectionHistory).toEqual(["alice", null, "alice"]);

    await act(async () => {
      emitNativeMapAndroidMarkerTap("bob");
      await Promise.resolve();
    });
    await flushEffects();
    expect(selectionHistory).toEqual(["alice", null, "alice", "bob"]);
  });

  test("map-background press remounts the prior annotation so the next Android tap selects", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const selectionHistory: Array<string | null> = [];

    await renderSelectableNativeMap([alice], selectionHistory);
    await act(async () => {
      emitNativeMapAndroidMarkerTap("alice");
      await Promise.resolve();
    });
    await flushEffects();
    expect(selectionHistory).toEqual(["alice"]);
    expect(getNativeMapAnnotationMountCount("alice")).toBe(1);

    await act(async () => {
      emitNativeMapPress();
      await Promise.resolve();
    });
    await flushEffects();
    expect(selectionHistory).toEqual(["alice", null]);
    expect(getNativeMapAnnotationMountCount("alice")).toBe(2);

    await act(async () => {
      emitNativeMapAndroidMarkerTap("alice");
      await Promise.resolve();
    });
    await flushEffects();
    expect(selectionHistory).toEqual(["alice", null, "alice"]);
  });

  test("does not pass a controlled selected prop on Android", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });

    await renderNativeMap({
      markers: [alice],
      selectedUserId: "alice",
    });

    expect(getNativeMapAnnotationSelectedProp("alice")).toBeUndefined();
  });

  test("observes Android annotation refresh after async self heading changes", async () => {
    const self = createLiveMapMarkerFixture({
      initials: "ME",
      isSelf: true,
      name: "Me",
      userId: "self",
    });

    setNativeMapSelfHeadingDegrees(10);
    await renderNativeMap({ markers: [self] });
    await flushEffects();

    const refreshCountAfterMount = getNativeMapAnnotationRefreshCalls().filter(
      (id) => id === "self",
    ).length;
    expect(refreshCountAfterMount).toBeGreaterThan(0);

    await act(async () => {
      await Promise.resolve();
      setNativeMapSelfHeadingDegrees(45);
      root?.render(<NativeMap markers={[self]} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      getNativeMapAnnotationRefreshCalls().filter((id) => id === "self").length,
    ).toBeGreaterThan(refreshCountAfterMount);
  });

  test("refreshes the self annotation when heading clears after focus loss", async () => {
    const self = createLiveMapMarkerFixture({
      initials: "ME",
      isSelf: true,
      name: "Me",
      userId: "self",
    });

    setNativeMapSelfHeadingDegrees(90);
    await renderNativeMap({ markers: [self] });
    await flushEffects();

    const refreshCountWithHeading = getNativeMapAnnotationRefreshCalls().filter(
      (id) => id === "self",
    ).length;

    setNativeMapSelfHeadingDegrees(null);
    await renderNativeMap({ markers: [self] });
    await flushEffects();

    expect(
      getNativeMapAnnotationRefreshCalls().filter((id) => id === "self").length,
    ).toBeGreaterThan(refreshCountWithHeading);
  });

  test("refreshes non-self annotations when avatar, initials, or ring color change", async () => {
    const alice = createLiveMapMarkerFixture({
      image: null,
      initials: "AL",
      ringColor: "#3366FF",
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    const refreshCountAfterMount = getNativeMapAnnotationRefreshCalls().filter(
      (id) => id === "alice",
    ).length;
    expect(refreshCountAfterMount).toBeGreaterThan(0);

    await renderNativeMap({
      markers: [
        {
          ...alice,
          image: "https://cdn.example/alice.png",
        },
      ],
    });
    await flushEffects();

    const refreshCountAfterImage = getNativeMapAnnotationRefreshCalls().filter(
      (id) => id === "alice",
    ).length;
    expect(refreshCountAfterImage).toBeGreaterThan(refreshCountAfterMount);

    await renderNativeMap({
      markers: [
        {
          ...alice,
          image: "https://cdn.example/alice.png",
          initials: "AA",
        },
      ],
    });
    await flushEffects();

    const refreshCountAfterInitials = getNativeMapAnnotationRefreshCalls().filter(
      (id) => id === "alice",
    ).length;
    expect(refreshCountAfterInitials).toBeGreaterThan(refreshCountAfterImage);

    await renderNativeMap({
      markers: [
        {
          ...alice,
          image: "https://cdn.example/alice.png",
          initials: "AA",
          ringColor: "#FF3366",
        },
      ],
    });
    await flushEffects();

    expect(
      getNativeMapAnnotationRefreshCalls().filter((id) => id === "alice").length,
    ).toBeGreaterThan(refreshCountAfterInitials);
  });

  test("refreshes annotations when async avatar bitmap content settles", async () => {
    const alice = createLiveMapMarkerFixture({
      image: "https://cdn.example/alice.png",
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    const refreshCountAfterMount = getNativeMapAnnotationRefreshCalls().filter(
      (id) => id === "alice",
    ).length;

    const onBitmapContentChange = (
      globalThis as typeof globalThis & { __nativeMapPinBitmapContentChange?: () => void }
    ).__nativeMapPinBitmapContentChange;
    expect(onBitmapContentChange).toBeTypeOf("function");

    await act(async () => {
      onBitmapContentChange?.();
      await Promise.resolve();
    });

    expect(
      getNativeMapAnnotationRefreshCalls().filter((id) => id === "alice").length,
    ).toBeGreaterThan(refreshCountAfterMount);
  });

  test("refreshes annotations when avatar bitmap load fails via the same content-change seam", async () => {
    const alice = createLiveMapMarkerFixture({
      image: "https://cdn.example/alice-broken.png",
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    const refreshCountAfterMount = getNativeMapAnnotationRefreshCalls().filter(
      (id) => id === "alice",
    ).length;

    const onBitmapContentChange = (
      globalThis as typeof globalThis & { __nativeMapPinBitmapContentChange?: () => void }
    ).__nativeMapPinBitmapContentChange;
    expect(onBitmapContentChange).toBeTypeOf("function");

    await act(async () => {
      onBitmapContentChange?.();
      await Promise.resolve();
    });

    expect(
      getNativeMapAnnotationRefreshCalls().filter((id) => id === "alice").length,
    ).toBeGreaterThan(refreshCountAfterMount);
  });

  test("remounts the map view when the signed pmtiles url changes and keeps camera drivers available", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapStyle()).toEqual({
      pmtilesUrl: "https://cached.example/pmtiles-1",
      version: 8,
    });

    const cameraCommandsBeforeUrlChange = getNativeMapCameraCommands().length;

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        expiresAt: "2026-03-31T12:30:00.000Z",
        refreshAt: "2026-03-31T12:29:00.000Z",
        url: "https://cached.example/pmtiles-2",
      },
    };

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapStyle()).toEqual({
      pmtilesUrl: "https://cached.example/pmtiles-2",
      version: 8,
    });
    expect(getNativeMapCameraCommands().length).toBeGreaterThan(cameraCommandsBeforeUrlChange);
  });
});
