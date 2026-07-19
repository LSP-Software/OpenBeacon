import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { createReactNativeTestModule } from "../../test/reactNativeTestModule.ts";
import {
  createLiveMapMarkerFixture,
  createMapLibreMockModule,
  emitNativeMapAnnotationDeselected,
  emitNativeMapAnnotationSelected,
  emitNativeMapDidFailLoadingMap,
  emitNativeMapDidFinishLoadingStyle,
  emitNativeMapPress,
  emitNativeMapRegionDidChange,
  emitNativeMapShowEveryone,
  getNativeMapAnnotationRefreshCalls,
  getNativeMapCameraCommands,
  getNativeMapMountedAnnotationIds,
  getNativeMapSelfHeadingDegrees,
  getNativeMapStyle,
  getNativeMapViewMountCount,
  registerNativeMapShowEveryoneHandler,
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

mock.module("react-native", () => {
  const reactNative = createReactNativeTestModule({ platformOS: "android" });
  return {
    ...reactNative,
    Pressable: (props: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) => {
      if (props.accessibilityLabel === "Show everyone") {
        registerNativeMapShowEveryoneHandler(props.onPress ?? null);
      }
      return reactNative.Pressable(props);
    },
  };
});

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
  LiveMapMarkerPin: () => React.createElement("live-map-marker-pin"),
}));

const { NativeMap }: typeof import("./NativeMap.tsx") = await import("./NativeMap.tsx");

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const emitUserPanAfterProgrammaticCamera = () => {
  const originalNow = Date.now;
  const afterSuppressWindow = originalNow() + 10_000;
  Date.now = () => afterSuppressWindow;
  try {
    emitNativeMapRegionDidChange(true);
  } finally {
    Date.now = originalNow;
  }
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

  test("coalesces the initial marker cohort instead of locking onto the first partial set", async () => {
    const self = createLiveMapMarkerFixture({
      initials: "ME",
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      name: "Me",
      userId: "self",
    });
    const alice = createLiveMapMarkerFixture({
      initials: "AL",
      latitude: 50.8,
      longitude: -1.1,
      name: "Alice",
      userId: "alice",
    });

    await renderNativeMap({ markers: [self] });
    await flushEffects();

    expect(
      getNativeMapCameraCommands().filter((command) => command.type === "setCamera"),
    ).toHaveLength(1);

    await renderNativeMap({ markers: [self, alice] });
    await flushEffects();

    expect(
      getNativeMapCameraCommands().filter((command) => command.type === "fitBounds"),
    ).toHaveLength(1);
  });

  test("focuses selection once with zoom, then follows without resetting zoom", async () => {
    const alice = createLiveMapMarkerFixture({
      initials: "AL",
      latitude: 51.5,
      longitude: -0.12,
      name: "Alice",
      userId: "alice",
    });
    const aliceMoved = createLiveMapMarkerFixture({
      ...alice,
      latitude: 51.51,
      longitude: -0.11,
    });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();
    const commandsBeforeSelection = getNativeMapCameraCommands().length;

    await renderNativeMap({
      markers: [alice],
      selectedUserId: "alice",
    });
    await flushEffects();

    const focusStop = getNativeMapCameraCommands()
      .slice(commandsBeforeSelection)
      .find((command) => command.type === "setCamera");
    expect(focusStop).toEqual({
      type: "setCamera",
      stop: expect.objectContaining({
        animationMode: "flyTo",
        centerCoordinate: [-0.12, 51.5],
        zoomLevel: 15,
      }),
    });

    const commandsAfterFocus = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [aliceMoved],
      selectedUserId: "alice",
    });
    await flushEffects();

    const followStop = getNativeMapCameraCommands()
      .slice(commandsAfterFocus)
      .find((command) => command.type === "setCamera");
    expect(followStop).toEqual({
      type: "setCamera",
      stop: {
        animationDuration: 400,
        animationMode: "easeTo",
        centerCoordinate: [-0.11, 51.51],
        padding: expect.any(Object),
      },
    });
    expect(followStop && "stop" in followStop ? followStop.stop : null).not.toHaveProperty(
      "zoomLevel",
    );
  });

  test("heading-only updates do not issue camera commands while following", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });

    await renderNativeMap({
      markers: [alice],
      selectedUserId: "alice",
    });
    await flushEffects();

    const commandsAfterFocus = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [alice],
      selectedUserId: "alice",
    });
    await flushEffects();

    expect(getNativeMapCameraCommands().length).toBe(commandsAfterFocus);
  });

  test("policy: manual pan ends follow until the user selects again", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });
    const aliceMoved = createLiveMapMarkerFixture({
      ...alice,
      latitude: 51.6,
      longitude: -0.1,
    });

    await renderNativeMap({
      markers: [alice],
      selectedUserId: "alice",
    });
    await flushEffects();

    emitUserPanAfterProgrammaticCamera();

    const commandsAfterPan = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [aliceMoved],
      selectedUserId: "alice",
    });
    await flushEffects();

    expect(getNativeMapCameraCommands().length).toBe(commandsAfterPan);

    await renderNativeMap({
      markers: [aliceMoved],
      selectedUserId: null,
    });
    await flushEffects();
    await renderNativeMap({
      markers: [aliceMoved],
      selectedUserId: "alice",
    });
    await flushEffects();

    const refocusStop = getNativeMapCameraCommands()
      .slice(commandsAfterPan)
      .find(
        (command) =>
          command.type === "setCamera" &&
          typeof command.stop === "object" &&
          command.stop !== null &&
          "zoomLevel" in command.stop,
      );
    expect(refocusStop).toBeDefined();
  });

  test("programmatic camera moves do not suspend follow when MapLibre marks them as user interaction", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });
    const aliceMoved = createLiveMapMarkerFixture({
      ...alice,
      latitude: 51.6,
      longitude: -0.1,
    });

    await renderNativeMap({
      markers: [alice],
      selectedUserId: "alice",
    });
    await flushEffects();

    emitNativeMapRegionDidChange(true);

    const commandsAfterQuirk = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [aliceMoved],
      selectedUserId: "alice",
    });
    await flushEffects();

    const followStop = getNativeMapCameraCommands()
      .slice(commandsAfterQuirk)
      .find((command) => command.type === "setCamera");
    expect(followStop).toEqual({
      type: "setCamera",
      stop: {
        animationDuration: 400,
        animationMode: "easeTo",
        centerCoordinate: [-0.1, 51.6],
        padding: expect.any(Object),
      },
    });
  });

  test("selection closes initial cohort coalescing so later arrivals do not steal focus", async () => {
    const self = createLiveMapMarkerFixture({
      initials: "ME",
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      name: "Me",
      userId: "self",
    });
    const alice = createLiveMapMarkerFixture({
      initials: "AL",
      latitude: 50.8,
      longitude: -1.1,
      name: "Alice",
      userId: "alice",
    });

    await renderNativeMap({
      markers: [self],
      selectedUserId: "self",
    });
    await flushEffects();

    const commandsAfterSelection = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [self, alice],
      selectedUserId: "self",
    });
    await flushEffects();

    expect(
      getNativeMapCameraCommands()
        .slice(commandsAfterSelection)
        .some((command) => command.type === "fitBounds"),
    ).toBe(false);
  });

  test("Show everyone remains available and fits the current marker cohort", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });
    const bob = createLiveMapMarkerFixture({
      initials: "BO",
      latitude: 50.8,
      longitude: -1.1,
      name: "Bob",
      userId: "bob",
    });
    const selections: Array<string | null> = [];

    await renderNativeMap({
      markers: [alice, bob],
      onSelectUserId: (userId) => {
        selections.push(userId);
      },
      selectedUserId: "alice",
    });
    await flushEffects();

    const commandsBeforeShowEveryone = getNativeMapCameraCommands().length;
    emitNativeMapShowEveryone();

    expect(selections).toEqual([null]);
    expect(
      getNativeMapCameraCommands()
        .slice(commandsBeforeShowEveryone)
        .some((command) => command.type === "fitBounds"),
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

  test("exposes a deselect driver for downstream tickets while NativeMap ignores onDeselected", async () => {
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

    expect(selections).toEqual([]);
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
