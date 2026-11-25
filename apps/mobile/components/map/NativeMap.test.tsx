import { afterEach, beforeEach, describe, expect, jest, mock, setSystemTime, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { MapPeople, MapPerson } from "../../lib/mapPeopleTypes.ts";
import { nextMapMarkerSelection } from "../../lib/mapMarkerSelection.ts";
import { createReactNativeTestModule } from "../../test/reactNativeTestModule.ts";
import {
  createLiveMapMarkerFixture,
  createMapLibreMockModule,
  emitNativeMapAndroidMarkerTap,
  emitNativeMapIosAnnotationTap,
  emitNativeMapDidFailLoadingMap,
  emitNativeMapLog,
  emitNativeMapDidFinishLoadingStyle,
  emitNativeMapGoToCurrentLocation,
  emitNativeMapPress,
  emitNativeMapRegionDidChange,
  emitNativeMapRegionIsChanging,
  emitNativeMapShowEveryone,
  getNativeMapAnnotationRefreshCalls,
  getNativeMapAnnotationSelectedProp,
  getNativeMapCameraCommands,
  getNativeMapCameraDefaultSettings,
  getNativeMapMountedAnnotationIds,
  getNativeMapSelfHeadingDegrees,
  getNativeMapRemovedStyleLayerIds,
  getNativeMapStyle,
  getNativeMapViewMountCount,
  getNativeMapUrlTransformEvents,
  getNativeMapUrlTransforms,
  registerNativeMapGoToCurrentLocationHandler,
  registerNativeMapShowEveryoneHandler,
  resetNativeMapHarness,
  setNativeMapSelfHeadingDegrees,
  setNativeMapProjectedPoint,
  setNativeMapProjectionWait,
} from "./nativeMap.testUtil.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let currentSignedPmtilesUrlQuery: {
  data?: {
    archiveId?: string;
    expiresAt: string;
    refreshAt: string;
    url: string;
  } | null;
  error?: {
    data?: {
      code?: string;
    };
  } | null;
  failureCount?: number;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isPaused?: boolean;
  refetch: () => Promise<void>;
};
type MapSource = { archiveId: string | null; sourceUrl: string };
let lastMapSource: MapSource | null = null;
const savedMapSources: MapSource[] = [];
let cachedTileClears = 0;
let forceRefreshMutationCalls = 0;
let forceRefreshMutationPending = false;
let forceRefreshMutationPaused = false;
let forceRefreshMutationSucceeds = true;
let deferForceRefresh = false;
let completeForceRefresh: (() => void) | null = null;
let forceRefreshUrl = "https://forced.example/pmtiles";
let forceRefreshArchiveId: string | undefined;
const setQueryData = mock(() => {});
const routerReplace = mock(() => {});
let root: Root | null = null;
const testPlatform = { OS: "ios" as "ios" | "android" };
let mapAssetUrls: { glyphs: string; sprites: string } | null = null;
const backPressListeners = new Set<() => boolean>();
const accessibilityAnnouncements: string[] = [];
let reduceMotionEnabled = false;
const appStateListeners = new Set<(nextAppState: string) => void>();

mock.module("react-native", () => {
  const reactNative = createReactNativeTestModule({
    appState: {
      currentState: "active",
      addEventListener: (_event, listener) => {
        appStateListeners.add(listener);
        return { remove: () => appStateListeners.delete(listener) };
      },
    },
    platformOS: "android",
  });
  return {
    ...reactNative,
    AccessibilityInfo: {
      addEventListener: () => ({ remove: () => {} }),
      announceForAccessibility: (message: string) => {
        accessibilityAnnouncements.push(message);
      },
      isReduceMotionEnabled: async () => reduceMotionEnabled,
      isScreenReaderEnabled: async () => false,
    },
    BackHandler: {
      addEventListener: (_event: "hardwareBackPress", listener: () => boolean) => {
        backPressListeners.add(listener);
        return { remove: () => backPressListeners.delete(listener) };
      },
    },
    Platform: testPlatform,
    ActivityIndicator: () => React.createElement("activity-indicator"),
    Animated: {
      View: ({ children }: { children?: React.ReactNode }) =>
        React.createElement("animated-view", null, children),
      Value: class {
        setValue() {}
      },
      parallel: () => ({ start: () => {} }),
      spring: () => ({ start: () => {} }),
      timing: () => ({ start: () => {} }),
    },
    View: ({
      children,
      onLayout,
    }: {
      children?: React.ReactNode;
      onLayout?: (event: {
        nativeEvent: { layout: { width: number; height: number; x: number; y: number } };
      }) => void;
    }) => React.createElement("view", { onLayout }, children),
    Pressable: (props: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      className?: string;
      hitSlop?: unknown;
      onPress?: () => void;
      style?: unknown;
    }) => {
      if (props.accessibilityLabel === "Show everyone") {
        registerNativeMapShowEveryoneHandler(props.onPress ?? null);
      }
      if (props.accessibilityLabel === "Go to current location") {
        registerNativeMapGoToCurrentLocationHandler(props.onPress ?? null);
      }
      return React.createElement(
        "pressable",
        {
          accessibilityLabel: props.accessibilityLabel,
          className: props.className,
          hitSlop: props.hitSlop,
          onClick: props.onPress,
          onPress: props.onPress,
          style: props.style,
        },
        props.children,
      );
    },
  };
});

mock.module("lucide-react-native", () => ({
  ChevronDownIcon: () => null,
  ArrowUpIcon: () => React.createElement("arrow-up-icon"),
  BackpackIcon: () => React.createElement("device-icon"),
  Flower2Icon: () => null,
  HeartIcon: () => null,
  StarIcon: () => null,
  SunIcon: () => null,
  TabletIcon: () => null,
  CarIcon: () => React.createElement("device-icon"),
  HouseIcon: () => React.createElement("device-icon"),
  LaptopIcon: () => React.createElement("device-icon"),
  SmartphoneIcon: () => React.createElement("device-icon"),
  TagIcon: () => React.createElement("device-icon"),
  WatchIcon: () => React.createElement("device-icon"),
  EyeOffIcon: () => React.createElement("eye-off-icon"),
  HistoryIcon: () => React.createElement("history-icon"),
  LayersIcon: () => React.createElement("layers-icon"),
  LocateFixedIcon: () => React.createElement("locate-fixed-icon"),
  MapPinIcon: () => React.createElement("map-pin-icon"),
  ScanIcon: () => React.createElement("scan-icon"),
  UsersIcon: () => React.createElement("users-icon"),
}));

mock.module("../ui/Icon.tsx", () => ({
  Icon: () => React.createElement("icon"),
}));

mock.module("@tanstack/react-query", () => ({
  useMutation: (options: {
    onError?: (error: Error) => void;
    onSuccess?: (data: unknown) => void;
  }) => ({
    isPaused: forceRefreshMutationPaused,
    isPending: forceRefreshMutationPending,
    mutate: () => {
      forceRefreshMutationCalls += 1;
      if (!forceRefreshMutationSucceeds) {
        options.onError?.(new Error("force refresh failed"));
        return;
      }

      const resultUrl = forceRefreshUrl;
      const resultArchiveId = forceRefreshArchiveId;
      const complete = () =>
        options.onSuccess?.({
          archiveId: resultArchiveId,
          expiresAt: "2026-03-31T12:20:00.000Z",
          refreshAt: "2026-03-31T12:19:00.000Z",
          url: resultUrl,
        });
      if (deferForceRefresh) completeForceRefresh = complete;
      else complete();
    },
  }),
  useQuery: () => currentSignedPmtilesUrlQuery,
}));

mock.module("@maplibre/maplibre-react-native", createMapLibreMockModule);
mock.module("react-native-reanimated", () => ({
  default: { createAnimatedComponent: <T,>(component: T) => component },
  useAnimatedProps: (props: () => object) => props(),
  useFrameCallback: () => ({ setActive: () => {} }),
  useSharedValue: <T,>(value: T) => React.useRef({ value }).current,
}));

let screenFocused = true;
mock.module("@react-navigation/native", () => ({
  useIsFocused: () => screenFocused,
}));

mock.module("expo-file-system", () => ({
  Paths: { bundle: { uri: "file:///app" } },
}));

mock.module("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
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

mock.module("../ui/Button.tsx", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("mock-button", props, children),
}));

mock.module("../../hooks/useSignedPmtilesUrl.ts", () => ({
  useSignedPmtilesUrl: () => currentSignedPmtilesUrlQuery,
}));

mock.module("../../hooks/useSelfDeviceHeading.ts", () => ({
  useSelfDeviceHeading: () => getNativeMapSelfHeadingDegrees(),
}));

mock.module("../../hooks/useUnits.ts", () => ({
  useUnits: () => ({ speed: "mph", distance: "mi" }),
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
  getProtomapsMapStyle: (
    _theme: "light" | "dark",
    pmtilesUrl: string,
    glyphs: string,
    sprites: string,
  ) => {
    mapAssetUrls = { glyphs, sprites };
    return {
      pmtilesUrl,
      version: 8,
      layers: [
        { id: "earth", type: "fill" },
        { id: "roads_labels_major", type: "symbol" },
        { id: "pois", type: "symbol" },
      ],
    };
  },
  getProtomapsThemeLayers: (_theme: "light" | "dark", showSymbols: boolean) => [
    { id: "earth", type: "fill" },
    ...["roads_labels_major", "pois"].map((id) => ({
      id,
      type: "symbol",
      layout: { visibility: showSymbols ? "visible" : "none" },
    })),
  ],
}));

mock.module("../../lib/mapCache.ts", () => ({
  prepareMapCache: async () => {},
  clearCachedMapTiles: async () => {
    cachedTileClears += 1;
  },
  readLastMapSource: () => lastMapSource,
  saveLastMapSource: (source: MapSource) => {
    savedMapSources.push(source);
  },
}));

mock.module("../../lib/storage.ts", () => ({
  storage: { getBoolean: () => undefined, set: () => {} },
}));

mock.module("./refreshViewAnnotation.ts", () => ({
  refreshViewAnnotation: (annotationRef: { current: { refresh: () => void } | null }) =>
    annotationRef.current?.refresh(),
}));

mock.module("../../providers/ThemeProvider.tsx", () => ({
  useAppTheme: () => "light" as const,
  useTheme: () => ({
    appTheme: "light" as const,
    mapTheme: "light" as const,
  }),
}));

mock.module("./LiveMapPersonSheet.tsx", () => ({
  LiveMapPersonSheet: ({ name, onRequestUpdate }: { name: string; onRequestUpdate?: unknown }) =>
    React.createElement("live-map-person-sheet", {
      canRequestUpdate: onRequestUpdate !== undefined,
      name,
    }),
}));

mock.module("./LiveMapPeopleTray.tsx", () => ({
  LiveMapPeopleTray: ({ onSelectPerson }: { onSelectPerson: (userId: string) => void }) =>
    React.createElement("live-map-people-tray", { onSelectPerson }),
}));

mock.module("./LiveMapMissingPersonSheet.tsx", () => ({
  LiveMapMissingPersonSheet: ({
    onRequestUpdate,
    onShowGroup,
    person,
  }: {
    onRequestUpdate?: () => Promise<void>;
    onShowGroup: (groupId: string) => void;
    person: { name: string };
  }) =>
    React.createElement("live-map-missing-person-sheet", {
      canRequestUpdate: onRequestUpdate !== undefined,
      name: person.name,
      onRequestUpdate,
      onShowGroup,
    }),
}));

mock.module("./LiveMapGroupVisibility.tsx", () => ({
  LiveMapGroupMenu: ({
    onSetHidden,
  }: {
    onSetHidden: (groupId: string, hidden: boolean) => void;
  }) => React.createElement("live-map-group-menu", { onSetHidden }),
  LiveMapHiddenGroupsNotice: (props: {
    onOpenMenu: () => void;
    onUndo: () => void;
    toastGroupNames: readonly string[];
  }) => React.createElement("live-map-hidden-groups-notice", props),
}));

mock.module("./LiveMapPlaceSheet.tsx", () => ({
  LiveMapPlaceSheet: ({ here }: { here: readonly LiveMapMarker[] }) =>
    React.createElement("live-map-place-sheet", { here: here.map((marker) => marker.userId) }),
}));

mock.module("./LiveMapStackSheet.tsx", () => ({
  LiveMapStackSheet: ({ members }: { members: readonly LiveMapMarker[] }) =>
    React.createElement("live-map-stack-sheet", { count: members.length }),
}));

mock.module("./LiveMapStackPin.tsx", () => ({
  LiveMapStackPin: ({ members }: { members: readonly LiveMapMarker[] }) =>
    React.createElement("live-map-stack-pin", { count: members.length }),
}));

mock.module("./PlacePin.tsx", () => ({
  PlacePin: () => React.createElement("place-pin"),
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

mock.module("./LiveMapSpeedChipAnnotation.tsx", () => ({
  LiveMapSpeedChipAnnotation: ({
    label,
    marker,
  }: {
    label: string;
    marker: { deviceId: string; name: string };
  }) => {
    const [annotationId] = React.useState(marker.deviceId);
    if (annotationId !== marker.deviceId) throw new Error("`id` cannot be changed");
    return React.createElement("speed-chip", { label, name: marker.name });
  },
}));

const { NativeMap }: typeof import("./NativeMap.tsx") = await import("./NativeMap.tsx");

const animationFrames = new Map<number, () => void>();
let lastAnimationFrame = 0;
const realAnimationFrames = {
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  requestAnimationFrame: globalThis.requestAnimationFrame,
};
const fakeAnimationFrames = {
  cancelAnimationFrame: (frame: number) => {
    animationFrames.delete(frame);
  },
  requestAnimationFrame: (callback: () => void) => {
    lastAnimationFrame += 1;
    animationFrames.set(lastAnimationFrame, callback);
    return lastAnimationFrame;
  },
};

const runAnimationFrames = async () => {
  await act(async () => {
    const frames = [...animationFrames.values()];
    animationFrames.clear();
    for (const frame of frames) frame();
  });
};

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
    emitNativeMapRegionDidChange({
      animated: false,
      isUserInteraction: true,
      latitude: 51.51,
      longitude: -0.13,
      zoomLevel: 14,
    });
  } finally {
    Date.now = originalNow;
  }
};

const renderNativeMap = async (props: React.ComponentProps<typeof NativeMap> = {}) => {
  if (!root) {
    root = createRoot();
  }

  await act(async () => {
    root?.render(<NativeMap {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const getRenderedOutput = () => {
  if (!root) {
    return "";
  }

  return JSON.stringify(root.container.toJSON());
};

const failMapLoad = async () => {
  await act(async () => {
    emitNativeMapDidFailLoadingMap();
    await Promise.resolve();
  });
};

const mapErrorText = "We couldn’t load the map";

const pressMapTryAgain = async () => {
  expect(getRenderedOutput()).toContain("Try again");
  const button = root?.container.queryAll((node) => node.type === "mock-button")[0];
  const onPress = button?.props["onPress"];
  if (typeof onPress !== "function") throw new Error("Missing Try again button");
  await act(async () => onPress());
};

const captureTimers = () => {
  const originalSetTimeout = globalThis.setTimeout;
  const timers = new Map<number, () => void>();
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    if (delay === 5_000 || delay === 300_000) {
      timers.set(delay, callback as () => void);
    }
    return originalSetTimeout(callback, delay);
  }) as typeof setTimeout;
  return {
    timers,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
    },
  };
};

const finishLoadingStyle = async () => {
  await act(async () => {
    emitNativeMapDidFinishLoadingStyle();
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
    const [selectedDeviceId, setSelectedDeviceId] = React.useState<string | null>(null);
    const selectedDeviceIdRef = React.useRef<string | null>(null);

    return (
      <NativeMap
        markers={markers}
        selectedDeviceId={selectedDeviceId}
        onSelectDeviceId={(userId) => {
          const next = nextMapMarkerSelection(selectedDeviceIdRef.current, userId);
          selectedDeviceIdRef.current = next;
          selectionHistory.push(next);
          setSelectedDeviceId(next);
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

describe("NativeMap over a fake MapLibre", () => {
  beforeEach(() => {
    testPlatform.OS = "ios";
    mapAssetUrls = null;
    backPressListeners.clear();
    accessibilityAnnouncements.length = 0;
    reduceMotionEnabled = false;
    appStateListeners.clear();
    resetNativeMapHarness();
    animationFrames.clear();
    Object.assign(globalThis, fakeAnimationFrames);
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
    forceRefreshMutationPaused = false;
    forceRefreshMutationSucceeds = true;
    screenFocused = true;
    deferForceRefresh = false;
    completeForceRefresh = null;
    forceRefreshUrl = "https://forced.example/pmtiles";
    forceRefreshArchiveId = undefined;
    setQueryData.mockReset();
    routerReplace.mockReset();
    lastMapSource = null;
    savedMapSources.length = 0;
    cachedTileClears = 0;
    root = null;
  });

  test.each([
    ["ios", "file:///app/map/fonts/{fontstack}/{range}.pbf", "file:///app/map/sprites"],
    ["android", "asset://map-assets/fonts/{fontstack}/{range}.pbf", "asset://map-assets/sprites"],
  ] as const)("uses packaged map URLs on %s", async (platform, glyphs, sprites) => {
    testPlatform.OS = platform;
    await renderNativeMap();
    expect(mapAssetUrls).toEqual({ glyphs, sprites });
  });

  test("offers a retry once the map link can't be loaded", async () => {
    let refetches = 0;
    currentSignedPmtilesUrlQuery = {
      data: null,
      error: { data: { code: "INTERNAL_SERVER_ERROR" } },
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: async () => {
        refetches += 1;
      },
    };
    await renderNativeMap();
    expect(getRenderedOutput()).toContain("We couldn’t load the map");
    const retry = root?.container.queryAll((node) => node.type === "mock-button")[0];
    const onPress = retry?.props["onPress"];
    if (typeof onPress !== "function") throw new Error("Missing retry button");
    await act(async () => onPress());
    expect(refetches).toBe(1);
  });

  test("toggles map symbols in place without replacing the style", async () => {
    await renderNativeMap();
    const mapStyleProp = () =>
      root?.container.queryAll((instance) => instance.type === "map-view")[0]?.props["mapStyle"];
    const styleLayers = () =>
      (root?.container.queryAll((instance) => instance.type === "style-layer") ?? []).map(
        (instance) => [instance.props["id"], instance.props["layout"]],
      );
    const toggle = () =>
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" &&
          instance.props["accessibilityLabel"] === "Show map names and symbols",
      )[0]?.props["onPress"] as () => void;
    const initialStyle = mapStyleProp();

    expect(styleLayers()).toEqual([
      ["earth", undefined],
      ["roads_labels_major", { visibility: "visible" }],
      ["pois", { visibility: "visible" }],
    ]);

    await act(async () => {
      toggle()();
      await Promise.resolve();
    });

    expect(styleLayers()).toEqual([
      ["earth", undefined],
      ["roads_labels_major", { visibility: "none" }],
      ["pois", { visibility: "none" }],
    ]);
    expect(mapStyleProp()).toBe(initialStyle);
    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapRemovedStyleLayerIds()).toEqual([]);
  });

  afterEach(async () => {
    setSystemTime();
    if (root) {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
      root = null;
    }
    expect(animationFrames.size).toBe(0);
    Object.assign(globalThis, realAnimationFrames);
  });

  describe("speed chip under the selected pin", () => {
    const renderAtStreetZoom = async (props: React.ComponentProps<typeof NativeMap>) => {
      await renderNativeMap(props);
      await act(async () => {
        emitNativeMapRegionDidChange({ latitude: 51.5, longitude: -0.12, zoomLevel: 14 });
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
    };
    const speedChips = () =>
      (root?.container.queryAll((instance) => instance.type === "speed-chip") ?? []).map((chip) => [
        chip.props["name"],
        chip.props["label"],
      ]);
    const alice = createLiveMapMarkerFixture({ name: "Alice", speed: 13.4, userId: "alice" });
    const bob = createLiveMapMarkerFixture({
      latitude: 50.8,
      longitude: -1.1,
      name: "Bob",
      speed: 13.4,
      userId: "bob",
    });

    beforeEach(() => {
      setSystemTime(new Date("2026-07-19T10:01:00.000Z"));
    });

    test("shows only on the selected moving person's pin", async () => {
      await renderAtStreetZoom({ markers: [alice, bob], selectedDeviceId: "alice" });
      expect(speedChips()).toEqual([["Alice", "30 mph"]]);
    });

    test("shows nowhere when no one is selected", async () => {
      await renderAtStreetZoom({ markers: [alice, bob] });
      expect(speedChips()).toEqual([]);
    });

    test("hides once the fix is over 3 minutes old", async () => {
      setSystemTime(new Date("2026-07-19T10:03:01.000Z"));
      await renderAtStreetZoom({ markers: [alice, bob], selectedDeviceId: "alice" });
      expect(speedChips()).toEqual([]);
    });

    test("moves to the next moving person tapped", async () => {
      await renderAtStreetZoom({ markers: [alice, bob], selectedDeviceId: "alice" });
      await renderAtStreetZoom({ markers: [alice, bob], selectedDeviceId: "bob" });
      expect(speedChips()).toEqual([["Bob", "30 mph"]]);
    });

    test("hides on a pin merging two of the person's devices", async () => {
      const phone = createLiveMapMarkerFixture({
        deviceId: "alice-phone",
        name: "Alice",
        speed: 13.4,
        timestamp: "2026-07-19T10:00:30.000Z",
        userId: "alice",
      });
      const watch = createLiveMapMarkerFixture({
        deviceId: "alice-watch",
        latitude: 51.5001,
        name: "Alice",
        speed: 13.4,
        userId: "alice",
      });
      await renderAtStreetZoom({ markers: [phone, watch], selectedDeviceId: "alice-phone" });
      expect(speedChips()).toEqual([]);
    });
  });

  test.each(["ios", "android"] as const)(
    "renders only one pin per person as the map edge is crossed on %s",
    async (platform) => {
      testPlatform.OS = platform;
      const marker = createLiveMapMarkerFixture({ userId: "alice" });
      setNativeMapProjectedPoint([-10, 300]);
      await renderNativeMap({ markers: [marker] });
      const views =
        root?.container.queryAll(
          (instance) =>
            instance.type === "view" && typeof instance.props["onLayout"] === "function",
        ) ?? [];
      await act(async () => {
        (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
          nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
        });
        (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
          nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      const edgePins = () =>
        root?.container.queryAll(
          (instance) =>
            instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Alice",
        ) ?? [];
      const nativePins = () =>
        getNativeMapMountedAnnotationIds().filter((id) => id === "alice").length;
      expect(edgePins()).toHaveLength(1);
      expect(nativePins()).toBe(0);
      setNativeMapProjectedPoint([200, 300]);
      await act(async () => {
        emitNativeMapRegionDidChange({ latitude: 51.5, longitude: -0.12, zoomLevel: 14 });
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(edgePins()).toHaveLength(0);
      expect(nativePins()).toBe(1);
    },
  );

  test("merges people at the same off-screen position into one chip", async () => {
    setNativeMapProjectedPoint([-100, 300]);
    await renderNativeMap({
      markers: [
        createLiveMapMarkerFixture({ userId: "alice", name: "Alice" }),
        createLiveMapMarkerFixture({ userId: "bob", name: "Bob" }),
      ],
    });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const chips =
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" &&
          String(instance.props["accessibilityLabel"]).includes("off screen"),
      ) ?? [];
    expect(chips).toHaveLength(1);
    expect(chips[0]?.props["accessibilityLabel"]).toBe("Show 2 people off screen");
  });

  test("keeps edge controls clear of on-screen people", async () => {
    await renderNativeMap({
      markers: [
        createLiveMapMarkerFixture({ userId: "alice", name: "Alice", latitude: 0, longitude: -20 }),
        createLiveMapMarkerFixture({ userId: "bob", name: "Bob", latitude: 0, longitude: -20 }),
        createLiveMapMarkerFixture({
          userId: "carol",
          name: "Carol",
          latitude: 0,
          longitude: -5.9,
        }),
      ],
    });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      emitNativeMapRegionIsChanging({
        latitude: 0,
        longitude: 0,
        zoomLevel: 4,
        visibleBounds: [
          [10, 10],
          [-10, -10],
        ],
      });
      await Promise.resolve();
    });
    const edges =
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" &&
          instance.props["accessibilityLabel"] === "Show 2 people off screen",
      ) ?? [];
    expect(edges).toHaveLength(1);
    for (const edge of edges) {
      const style = edge.props["style"] as { left: number; top: number };
      expect(Math.hypot(style.left + 24 - 82, style.top + 24 - 300)).toBeGreaterThanOrEqual(48);
    }
    expect(getNativeMapMountedAnnotationIds()).toContain("carol");
  });

  test("keeps edge pins above the open person sheet", async () => {
    setNativeMapProjectedPoint([200, 570]);
    await renderNativeMap({
      markers: [
        createLiveMapMarkerFixture({ userId: "alice" }),
        createLiveMapMarkerFixture({ latitude: 40, longitude: 10, name: "Bob", userId: "bob" }),
      ],
      selectedDeviceId: "alice",
    });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const edge = root?.container.queryAll(
      (instance) =>
        instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Bob",
    )[0];
    const style = edge?.props["style"] as { top: number } | undefined;
    expect(style?.top).toBeLessThanOrEqual(326);
  });

  test("keeps edge pins clear when the control stack changes size", async () => {
    const marker = createLiveMapMarkerFixture({ userId: "alice" });
    setNativeMapProjectedPoint([700, 100]);
    await renderNativeMap({ markers: [marker] });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 152, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const getEdge = () =>
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Alice",
      )[0];
    const firstStyle = getEdge()?.props["style"] as { left: number; top: number } | undefined;
    expect(
      firstStyle &&
        (firstStyle.left + 24 <= 316 || firstStyle.top + 24 <= 28 || firstStyle.top + 24 >= 236),
    ).toBe(true);
    await act(async () => {
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 240, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const nextStyle = getEdge()?.props["style"] as { left: number; top: number } | undefined;
    expect(
      nextStyle &&
        (nextStyle.left + 24 <= 316 || nextStyle.top + 24 <= 28 || nextStyle.top + 24 >= 324),
    ).toBe(true);
  });

  test("ignores a native projection started before the map is resized", async () => {
    const marker = createLiveMapMarkerFixture({ userId: "alice" });
    setNativeMapProjectedPoint([600, 300]);
    await renderNativeMap({ markers: [marker] });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    const layoutMap = views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined;
    await act(async () => {
      layoutMap?.({ nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } } });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getRenderedOutput()).toContain("Go to Alice");
    let release = () => {};
    setNativeMapProjectedPoint([200, 300]);
    setNativeMapProjectionWait(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      emitNativeMapRegionIsChanging({ latitude: 0, longitude: 0, zoomLevel: 4 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      layoutMap?.({ nativeEvent: { layout: { width: 600, height: 600, x: 0, y: 0 } } });
      setNativeMapProjectedPoint([800, 300]);
      release();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getRenderedOutput()).toContain("Go to Alice");
  });

  test("tracks camera motion while an older native projection is pending", async () => {
    const marker = createLiveMapMarkerFixture({ userId: "alice", latitude: 0, longitude: 20 });
    setNativeMapProjectedPoint([600, 300]);
    await renderNativeMap({ markers: [marker] });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const edge = () =>
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Alice",
      )[0];
    expect(edge()?.props["style"]).toMatchObject({ top: 276 });
    let release = () => {};
    setNativeMapProjectionWait(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      emitNativeMapRegionIsChanging({ latitude: 0, longitude: 0, zoomLevel: 4 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      emitNativeMapRegionIsChanging({
        latitude: 10,
        longitude: 0,
        zoomLevel: 4,
        visibleBounds: [
          [10, 20],
          [-10, 0],
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect((edge()?.props["style"] as { top: number } | undefined)?.top).toBeGreaterThan(300);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect((edge()?.props["style"] as { top: number } | undefined)?.top).toBeGreaterThan(300);
  });

  test("updates edge pins while camera movement continues", async () => {
    const marker = createLiveMapMarkerFixture({ userId: "alice" });
    setNativeMapProjectedPoint([600, 300]);
    await renderNativeMap({ markers: [marker] });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(getRenderedOutput()).toContain("Go to Alice");
    setNativeMapProjectedPoint([200, 300]);
    await act(async () => {
      for (let i = 0; i < 4; i++) {
        emitNativeMapRegionIsChanging({ latitude: 51.5, longitude: -0.12, zoomLevel: 14 });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    expect(getRenderedOutput()).not.toContain("Go to Alice");
  });

  test("keeps a gliding pin on the map until the pin itself leaves the screen", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const aliceFarEast = createLiveMapMarkerFixture({
      ...alice,
      longitude: -0.09,
      timestamp: "2026-07-19T10:00:10.000Z",
    });
    const aliceEdgePins = () =>
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Alice",
      ) ?? [];
    const alicePins = () =>
      getNativeMapMountedAnnotationIds().filter((id) => id === "alice").length;
    setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
    await renderNativeMap({ markers: [alice] });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      emitNativeMapRegionIsChanging({
        latitude: 51.5,
        longitude: -0.12,
        zoomLevel: 14,
        visibleBounds: [
          [-0.11, 51.505],
          [-0.13, 51.495],
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(aliceEdgePins()).toHaveLength(0);

    setSystemTime(new Date("2026-07-19T10:00:11.000Z"));
    await renderNativeMap({ markers: [aliceFarEast] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(aliceEdgePins()).toHaveLength(0);
    expect(alicePins()).toBe(1);

    setSystemTime(new Date("2026-07-19T10:00:30.000Z"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(aliceEdgePins()).toHaveLength(1);
    expect(alicePins()).toBe(0);
  });

  test("hides a tapped edge pin before the map camera reaches its person", async () => {
    const marker = createLiveMapMarkerFixture({ userId: "alice" });
    setNativeMapProjectedPoint([600, 300]);
    await renderNativeMap({ markers: [marker] });
    const mapContainer = root?.container.queryAll(
      (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
    )[0];
    expect(mapContainer).toBeDefined();
    await act(async () => {
      (mapContainer?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      const controls = root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      )[1];
      (controls?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 130));
    });
    const edge = root?.container.queryAll(
      (instance) =>
        instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Alice",
    )[0];
    expect(edge).toBeDefined();
    await act(async () => {
      (edge?.props["onPress"] as (() => void) | undefined)?.();
    });
    expect(getRenderedOutput()).not.toContain("Go to Alice");
    await act(async () => {
      emitNativeMapRegionIsChanging({
        latitude: 51.5,
        longitude: -0.12,
        zoomLevel: 14,
        animated: true,
        isUserInteraction: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getRenderedOutput()).not.toContain("Go to Alice");
  });

  test("does not restore a tapped edge pin when an older projection finishes", async () => {
    const marker = createLiveMapMarkerFixture({ userId: "alice" });
    setNativeMapProjectedPoint([600, 300]);
    await renderNativeMap({ markers: [marker] });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    let release = () => {};
    setNativeMapProjectionWait(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      emitNativeMapRegionIsChanging({
        latitude: 51.5,
        longitude: -0.12,
        zoomLevel: 14,
        animated: true,
        isUserInteraction: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const edge = root?.container.queryAll(
      (instance) =>
        instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Alice",
    )[0];
    expect(edge).toBeDefined();
    await act(async () => {
      (edge?.props["onPress"] as (() => void) | undefined)?.();
      release();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getRenderedOutput()).not.toContain("Go to Alice");
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

  test("ignores a force refresh that completes after the map unmounts", async () => {
    deferForceRefresh = true;
    await renderNativeMap();
    await failMapLoad();
    expect(completeForceRefresh).not.toBeNull();
    await act(async () => {
      root?.unmount();
      root = null;
    });
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, url: "https://second.example/map?signature=new" },
    };
    await renderNativeMap();
    const count = getNativeMapUrlTransforms().length;
    await act(async () => {
      completeForceRefresh?.();
    });
    expect(getNativeMapUrlTransforms()).toHaveLength(count);
    expect(getNativeMapUrlTransforms().at(-1)?.replace).toBe(
      "https://second.example/map?signature=new",
    );
    expect(setQueryData).not.toHaveBeenCalled();
  });

  test("keeps the source retry scheduled if the style loads after a PMTiles error", async () => {
    const { restore, timers } = captureTimers();
    try {
      await renderNativeMap();
      await act(async () => {
        emitNativeMapLog({
          level: "error",
          tag: "Mbgl",
          message:
            "[Style]: Failed to load source protomaps: Error fetching PMTiles header: timeout",
        });
      });
      expect(getRenderedOutput()).toContain(mapErrorText);
      await finishLoadingStyle();
      expect(getRenderedOutput()).toContain(mapErrorText);
      expect(timers.get(5_000)).toBeDefined();
      await act(async () => {
        timers.get(5_000)?.();
      });
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getNativeMapViewMountCount()).toBe(2);
      await finishLoadingStyle();
      expect(getRenderedOutput()).not.toContain(mapErrorText);
    } finally {
      restore();
    }
  });

  test("restores selected person padding when retrying the same archive", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice", latitude: 51.5, longitude: -0.12 });
    forceRefreshUrl = "https://cached.example/pmtiles-1?signature=new";
    await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
    await flushEffects();
    await failMapLoad();
    await finishLoadingStyle();
    const initialViewState = root?.container.queryAll((instance) => instance.type === "camera")[0]
      ?.props["initialViewState"];
    expect(initialViewState).toEqual(
      expect.objectContaining({ padding: { top: 56, right: 32, bottom: 220, left: 32 } }),
    );
  });

  test("recovers from PMTiles header errors reported through the native logger", async () => {
    const { restore, timers } = captureTimers();
    try {
      await renderNativeMap();
      expect(emitNativeMapLog({ level: "error", tag: "Mbgl", message: "unrelated error" })).toBe(
        false,
      );
      await act(async () => {
        expect(
          emitNativeMapLog({
            level: "error",
            tag: "Mbgl",
            message:
              "[Style]: Failed to load source protomaps: Error fetching PMTiles header: timeout",
          }),
        ).toBe(true);
      });
      expect(timers.get(5_000)).toBeDefined();
      await act(async () => {
        timers.get(5_000)?.();
      });
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getNativeMapViewMountCount()).toBe(2);
    } finally {
      restore();
    }
  });

  test("retries a PMTiles source failure again later when the first credential refresh fails", async () => {
    const { restore, timers } = captureTimers();
    try {
      await renderNativeMap();
      forceRefreshMutationSucceeds = false;
      await act(async () => {
        emitNativeMapLog({
          level: "error",
          tag: "Mbgl",
          message:
            "[Style]: Failed to load source protomaps: Error fetching PMTiles header: timeout",
        });
      });
      await act(async () => {
        timers.get(5_000)?.();
      });
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getNativeMapViewMountCount()).toBe(1);
      expect(getRenderedOutput()).toContain(mapErrorText);
      forceRefreshMutationSucceeds = true;
      await act(async () => {
        timers.get(300_000)?.();
      });
      expect(forceRefreshMutationCalls).toBe(2);
      expect(getNativeMapViewMountCount()).toBe(2);
    } finally {
      restore();
    }
  });

  test("retries the failed map source after credentials refresh without changing the archive", async () => {
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, url: "https://cached.example/pmtiles?signature=old" },
    };
    forceRefreshUrl = "https://cached.example/pmtiles?signature=new";
    await renderNativeMap();
    await flushEffects();
    expect(getNativeMapViewMountCount()).toBe(1);

    await failMapLoad();
    await flushEffects();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(getNativeMapUrlTransforms().at(-1)?.replace).toBe(forceRefreshUrl);
    expect(getNativeMapViewMountCount()).toBe(2);
  });

  test("preserves the current camera when retrying a failed map", async () => {
    await renderNativeMap();
    await flushEffects();
    emitNativeMapRegionDidChange({ latitude: 51.51, longitude: -0.13, zoomLevel: 12.5 });
    await failMapLoad();
    await flushEffects();
    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapCameraDefaultSettings()).toEqual({
      centerCoordinate: [-0.13, 51.51],
      zoomLevel: 12.5,
    });
  });

  test("forces one auto refresh per failure episode and does not loop when the url changes", async () => {
    await renderNativeMap();

    await failMapLoad();
    await failMapLoad();

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
    await failMapLoad();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(getRenderedOutput()).toContain(mapErrorText);
  });

  test("retries a map failure that occurs during a scheduled URL refresh", async () => {
    currentSignedPmtilesUrlQuery = { ...currentSignedPmtilesUrlQuery, isFetching: true };
    await renderNativeMap();
    await failMapLoad();
    expect(forceRefreshMutationCalls).toBe(0);
    currentSignedPmtilesUrlQuery = { ...currentSignedPmtilesUrlQuery, isFetching: false };
    await renderNativeMap();
    await flushEffects();
    expect(forceRefreshMutationCalls).toBe(1);
    expect(getNativeMapViewMountCount()).toBe(2);
  });

  test("does not force refresh while a force-refresh mutation is already pending", async () => {
    forceRefreshMutationPending = true;
    await renderNativeMap();

    await failMapLoad();

    expect(forceRefreshMutationCalls).toBe(0);
  });

  test("shows the map error after a failed refresh and retries it shortly after", async () => {
    const { restore, timers } = captureTimers();
    try {
      forceRefreshMutationSucceeds = false;
      await renderNativeMap();
      await failMapLoad();
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getRenderedOutput()).toContain(mapErrorText);
      expect(getRenderedOutput()).not.toContain("activity-indicator");
      expect(timers.get(5_000)).toBeDefined();

      forceRefreshMutationSucceeds = true;
      await act(async () => {
        timers.get(5_000)?.();
      });
      expect(forceRefreshMutationCalls).toBe(2);
      expect(setQueryData).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("stops retrying a failing map source on its own after two more attempts", async () => {
    const { restore, timers } = captureTimers();
    try {
      forceRefreshMutationSucceeds = false;
      await renderNativeMap();
      await failMapLoad();
      for (const delay of [5_000, 300_000]) {
        const retry = timers.get(delay);
        timers.clear();
        expect(retry).toBeDefined();
        await act(async () => {
          retry?.();
        });
      }
      await flushEffects();

      expect(forceRefreshMutationCalls).toBe(3);
      expect(timers.size).toBe(0);
      expect(getRenderedOutput()).toContain(mapErrorText);
    } finally {
      restore();
    }
  });

  test("Try again on the map error retries the map source", async () => {
    forceRefreshMutationSucceeds = false;
    await renderNativeMap();
    await failMapLoad();
    expect(forceRefreshMutationCalls).toBe(1);

    forceRefreshMutationSucceeds = true;
    await pressMapTryAgain();

    expect(forceRefreshMutationCalls).toBe(2);
    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getRenderedOutput()).not.toContain(mapErrorText);
  });

  test("does not retry the map source while the map screen is in the background", async () => {
    const { restore, timers } = captureTimers();
    try {
      screenFocused = false;
      forceRefreshMutationSucceeds = false;
      await renderNativeMap();
      await failMapLoad();

      expect(timers.size).toBe(0);
    } finally {
      restore();
    }
  });

  test("shows the map error instead of a spinner while the refresh waits for a connection", async () => {
    deferForceRefresh = true;
    await renderNativeMap();
    await failMapLoad();
    forceRefreshMutationPending = true;
    forceRefreshMutationPaused = true;
    await renderNativeMap();

    expect(getRenderedOutput()).toContain(mapErrorText);
    expect(getRenderedOutput()).not.toContain("activity-indicator");
  });

  test("resets the failure retry gate after the style finishes loading", async () => {
    await renderNativeMap();

    await failMapLoad();
    expect(forceRefreshMutationCalls).toBe(1);

    await finishLoadingStyle();
    await failMapLoad();

    expect(forceRefreshMutationCalls).toBe(2);
  });

  test("scheduled pmtiles url refresh preserves camera and does not refit everyone", async () => {
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
    await finishLoadingStyle();
    await flushEffects();

    const fitCountBeforeRefresh = getNativeMapCameraCommands().filter(
      (command) => command.type === "fitBounds",
    ).length;
    expect(fitCountBeforeRefresh).toBe(1);

    emitNativeMapRegionDidChange({
      latitude: 51.51,
      longitude: -0.13,
      zoomLevel: 12.5,
    });

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        expiresAt: "2026-03-31T12:30:00.000Z",
        refreshAt: "2026-03-31T12:29:00.000Z",
        url: "https://cached.example/pmtiles-1?signature=refreshed",
      },
    };

    const styleBeforeRefresh = getNativeMapStyle();
    const cameraCommandsBeforeRefresh = getNativeMapCameraCommands().length;

    await renderNativeMap({ markers: [alice, bob] });
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapStyle()).toEqual(styleBeforeRefresh);
    expect(getNativeMapCameraCommands().length).toBe(cameraCommandsBeforeRefresh);
    expect(
      getNativeMapCameraCommands().filter((command) => command.type === "fitBounds").length,
    ).toBe(fitCountBeforeRefresh);
  });

  test("scheduled refresh restores selected-person camera after remount", async () => {
    const alice = createLiveMapMarkerFixture({
      isSelf: true,
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

    await renderNativeMap({
      markers: [alice, bob],
      selectedDeviceId: "alice",
    });
    await flushEffects();

    const fitCountBeforeRefresh = getNativeMapCameraCommands().filter(
      (command) => command.type === "fitBounds",
    ).length;

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        expiresAt: "2026-03-31T12:30:00.000Z",
        refreshAt: "2026-03-31T12:29:00.000Z",
        url: "https://cached.example/pmtiles-2",
      },
    };

    await renderNativeMap({
      markers: [alice, bob],
      selectedDeviceId: "alice",
    });
    await flushEffects();
    await finishLoadingStyle();

    expect(
      getNativeMapCameraCommands().filter((command) => command.type === "fitBounds").length,
    ).toBe(fitCountBeforeRefresh);
    expect(
      getNativeMapCameraCommands().some(
        (command) =>
          command.type === "setCamera" &&
          typeof command.stop === "object" &&
          command.stop !== null &&
          "centerCoordinate" in command.stop &&
          (command.stop as { centerCoordinate: [number, number] }).centerCoordinate[0] === -0.12 &&
          (command.stop as { zoomLevel?: number }).zoomLevel === 15 &&
          (command.stop as { animationDuration?: number }).animationDuration === 0,
      ),
    ).toBe(true);
  });

  test("waits for the map style to load before the first fit", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();
    expect(getNativeMapCameraCommands()).toEqual([]);

    await finishLoadingStyle();
    await flushEffects();
    expect(
      getNativeMapCameraCommands().filter((command) => command.type === "setCamera"),
    ).toHaveLength(1);
  });

  test("jumps to the first location and jumps again to frame people whose locations load later", async () => {
    const self = createLiveMapMarkerFixture({
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      userId: "self",
    });
    const alice = createLiveMapMarkerFixture({
      latitude: 50.8,
      longitude: -1.1,
      userId: "alice",
    });

    await renderNativeMap({ locationsLoading: true, markers: [self] });
    await finishLoadingStyle();
    await flushEffects();
    expect(getNativeMapCameraCommands()[0]).toMatchObject({
      type: "setCamera",
      stop: { animationDuration: 0, centerCoordinate: [-0.12, 51.5], zoomLevel: 14 },
    });

    await renderNativeMap({ locationsLoading: false, markers: [self, alice] });
    await flushEffects();
    expect(getNativeMapCameraCommands().filter((command) => command.type === "fitBounds")).toEqual([
      {
        type: "fitBounds",
        ne: [-0.12, 51.5],
        sw: [-1.1, 50.8],
        padding: expect.any(Array),
        duration: 0,
      },
    ]);
  });

  test("follows your own pin from a stale cached position to the first live fix", async () => {
    const cached = createLiveMapMarkerFixture({
      isSelf: true,
      latitude: 51.5,
      longitude: -0.12,
      userId: "self",
    });

    await renderNativeMap({ locationsLoading: true, markers: [cached] });
    await finishLoadingStyle();
    await flushEffects();
    await renderNativeMap({
      locationsLoading: true,
      markers: [{ ...cached, latitude: 51.4, longitude: -0.3 }],
    });
    await flushEffects();

    expect(
      getNativeMapCameraCommands()
        .filter((command) => command.type === "setCamera")
        .map((command) => command.stop),
    ).toEqual([
      expect.objectContaining({ animationDuration: 0, centerCoordinate: [-0.12, 51.5] }),
      expect.objectContaining({ animationDuration: 0, centerCoordinate: [-0.3, 51.4] }),
    ]);
  });

  test("preserves programmatic fit camera across remount without region events", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
    await finishLoadingStyle();
    await flushEffects();

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

    expect(getNativeMapCameraDefaultSettings()).toEqual({
      centerCoordinate: [-0.12, 51.5],
      zoomLevel: 14,
    });
  });

  test("repeated map-load failures show the map error instead of looping", async () => {
    await renderNativeMap();

    await failMapLoad();
    expect(forceRefreshMutationCalls).toBe(1);

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        expiresAt: "2026-03-31T12:30:00.000Z",
        refreshAt: "2026-03-31T12:29:00.000Z",
        url: "https://forced.example/pmtiles",
      },
    };
    await renderNativeMap();
    await failMapLoad();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(getRenderedOutput()).toContain(mapErrorText);

    await failMapLoad();
    await failMapLoad();
    expect(forceRefreshMutationCalls).toBe(1);
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
    await finishLoadingStyle();
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

  test("moves the camera without animation when Reduce motion is on", async () => {
    reduceMotionEnabled = true;
    const alice = createLiveMapMarkerFixture({
      initials: "AL",
      latitude: 51.5,
      longitude: -0.12,
      name: "Alice",
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
    await finishLoadingStyle();
    await flushEffects();
    await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
    await flushEffects();

    const moves = getNativeMapCameraCommands().filter((command) => command.type === "setCamera");
    expect(moves.length).toBeGreaterThan(1);
    for (const move of moves) {
      expect(move).toEqual({
        type: "setCamera",
        stop: expect.objectContaining({ animationDuration: 0 }),
      });
      expect(move).toEqual({
        type: "setCamera",
        stop: expect.not.objectContaining({ animationMode: expect.anything() }),
      });
    }
    expect(moves.at(-1)).toEqual({
      type: "setCamera",
      stop: expect.objectContaining({ centerCoordinate: [-0.12, 51.5], zoomLevel: 15 }),
    });
  });

  test("gives every map control a touch target of at least 48 dp", async () => {
    const self = createLiveMapMarkerFixture({ isSelf: true, userId: "self" });
    await renderNativeMap({
      groupOptions: [
        { color: "#FF1464", hidden: false, id: "family", memberCount: 1, name: "Family" },
        { color: "#2A9D8F", hidden: false, id: "club", memberCount: 1, name: "Club" },
      ],
      markers: [self],
      people: null,
      timelineGroupId: "family",
    });
    const sizes: Record<string, number> = { "h-10": 40, "size-11": 44, "size-12": 48 };
    const controls = (root?.container.queryAll((node) => node.type === "pressable") ?? []).filter(
      (node) =>
        [
          "Groups on the map",
          "Show map names and symbols",
          "Timeline",
          "People",
          "Show everyone",
          "Go to current location",
        ].includes(String(node.props["accessibilityLabel"])),
    );
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      const height = Object.entries(sizes).find(([name]) =>
        String(control.props["className"]).split(" ").includes(name),
      )?.[1];
      const slop = control.props["hitSlop"] as { top?: number; bottom?: number } | undefined;
      expect({
        label: control.props["accessibilityLabel"],
        height: (height ?? 0) + (slop?.top ?? 0) + (slop?.bottom ?? 0),
      }).toEqual({ label: control.props["accessibilityLabel"], height: 48 });
    }
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
      selectedDeviceId: "alice",
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
    setSystemTime(new Date(Date.now() + 2_000));
    await renderNativeMap({
      markers: [aliceMoved],
      selectedDeviceId: "alice",
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

  describe("following a moving person", () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const aliceMoved = createLiveMapMarkerFixture({
      ...alice,
      latitude: 51.5 + 130 / 111_320,
      timestamp: "2026-07-19T10:00:10.000Z",
    });
    const trayProps = {
      onSelectDeviceId: () => {},
      people: {
        cantLocate: [],
        cantRead: [],
        finding: [],
        hidden: [],
        outOfDate: [],
        paused: [],
        upToDate: [],
        waiting: [],
        waitingForLocation: [],
      },
      peopleTrayOpen: true,
    };
    const setCameraStopsSince = (index: number) =>
      getNativeMapCameraCommands()
        .slice(index)
        .flatMap((command) => (command.type === "setCamera" ? [command.stop] : []));
    const northMetersAt = (latitude: unknown) => ((latitude as number) - 51.5) * 111_320;
    const tapAliceInTray = async () => {
      const [tray] =
        root?.container.queryAll((instance) => instance.type === "live-map-people-tray") ?? [];
      await act(async () =>
        (tray?.props["onSelectPerson"] as ((userId: string) => void) | undefined)?.("alice"),
      );
    };
    const waitForFlyToToEnd = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_250));
      });

    test("moves the camera once, linearly, to where the pin's glide ends", async () => {
      setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
      await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
      await flushEffects();
      const commandsBeforeMove = getNativeMapCameraCommands().length;
      setSystemTime(new Date("2026-07-19T10:00:11.000Z"));
      await renderNativeMap({ markers: [aliceMoved], selectedDeviceId: "alice" });
      await flushEffects();

      expect(setCameraStopsSince(commandsBeforeMove)).toEqual([
        {
          animationDuration: 12_000,
          animationMode: "linear",
          centerCoordinate: [-0.12, aliceMoved.latitude],
          padding: expect.any(Object),
        },
      ]);

      setSystemTime(new Date("2026-07-19T10:00:15.000Z"));
      await renderNativeMap({ markers: [aliceMoved], selectedDeviceId: "alice" });
      await flushEffects();
      expect(setCameraStopsSince(commandsBeforeMove)).toHaveLength(1);
    });

    test("stops following after a pan", async () => {
      setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
      await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
      await flushEffects();
      emitUserPanAfterProgrammaticCamera();
      const commandsAfterPan = getNativeMapCameraCommands().length;
      setSystemTime(new Date("2026-07-19T10:00:11.000Z"));
      await renderNativeMap({ markers: [aliceMoved], selectedDeviceId: "alice" });
      await flushEffects();

      expect(setCameraStopsSince(commandsAfterPan)).toEqual([]);
    });

    test("a new location mid-glide starts one new linear move from where the camera is", async () => {
      setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
      await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
      await flushEffects();
      setSystemTime(new Date("2026-07-19T10:00:11.000Z"));
      await renderNativeMap({ markers: [aliceMoved], selectedDeviceId: "alice" });
      await flushEffects();
      const commandsBeforeNextFix = getNativeMapCameraCommands().length;
      const aliceMovedAgain = createLiveMapMarkerFixture({
        ...aliceMoved,
        latitude: aliceMoved.latitude + 130 / 111_320,
        timestamp: "2026-07-19T10:00:20.000Z",
      });
      setSystemTime(new Date("2026-07-19T10:00:21.000Z"));
      await renderNativeMap({ markers: [aliceMovedAgain], selectedDeviceId: "alice" });
      await flushEffects();

      expect(getNativeMapCameraCommands().slice(commandsBeforeNextFix)).toEqual([
        {
          type: "setCamera",
          stop: {
            animationDuration: 12_000,
            animationMode: "linear",
            centerCoordinate: [-0.12, aliceMovedAgain.latitude],
            padding: expect.any(Object),
          },
        },
      ]);
    });

    test("a pan cancels the camera reset booked for the end of the follow move", async () => {
      setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
      await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
      await flushEffects();
      jest.useFakeTimers({ now: new Date("2026-07-19T10:00:11.000Z") });
      try {
        await renderNativeMap({ markers: [aliceMoved], selectedDeviceId: "alice" });
        await flushEffects();
        emitUserPanAfterProgrammaticCamera();
        const commandsAfterPan = getNativeMapCameraCommands().length;
        await act(async () => {
          jest.advanceTimersByTime(13_000);
        });

        expect(getNativeMapCameraCommands().slice(commandsAfterPan)).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    test("stops the camera when the person is deselected part-way through a glide", async () => {
      setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
      await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
      await flushEffects();
      setSystemTime(new Date("2026-07-19T10:00:11.000Z"));
      await renderNativeMap({ markers: [aliceMoved], selectedDeviceId: "alice" });
      await flushEffects();
      const commandsBeforeDeselect = getNativeMapCameraCommands().length;
      setSystemTime(new Date("2026-07-19T10:00:14.000Z"));
      await renderNativeMap({ markers: [aliceMoved], selectedDeviceId: null });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });

      expect(getNativeMapCameraCommands().slice(commandsBeforeDeselect)).toEqual([
        { type: "setStop", stop: { duration: 0 } },
      ]);
    });

    test("waits for the fly-to a person tapped in the tray, then follows their moving pin", async () => {
      setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
      await renderNativeMap({ ...trayProps, markers: [alice] });
      setSystemTime(new Date("2026-07-19T10:00:11.000Z"));
      await renderNativeMap({ ...trayProps, markers: [aliceMoved] });
      const commandsBeforeTap = getNativeMapCameraCommands().length;
      await tapAliceInTray();
      await renderNativeMap({ ...trayProps, markers: [aliceMoved], selectedDeviceId: "alice" });

      const [flyTo] = setCameraStopsSince(commandsBeforeTap) as Array<{
        centerCoordinate: [number, number];
      }>;
      expect(flyTo).toMatchObject({
        animationDuration: 1200,
        animationMode: "flyTo",
        zoomLevel: 15,
      });
      expect(northMetersAt(flyTo?.centerCoordinate[1])).toBeCloseTo((130 * 1.2) / 12, 4);
      expect(setCameraStopsSince(commandsBeforeTap)).toHaveLength(1);

      setSystemTime(new Date("2026-07-19T10:00:12.200Z"));
      await waitForFlyToToEnd();
      expect(setCameraStopsSince(commandsBeforeTap).slice(1)).toEqual([
        {
          animationDuration: 10_800,
          animationMode: "linear",
          centerCoordinate: [-0.12, aliceMoved.latitude],
          padding: expect.any(Object),
        },
      ]);
    });

    test("follows again when the same person is tapped in the tray after a pan", async () => {
      setSystemTime(new Date("2026-07-19T10:00:01.000Z"));
      await renderNativeMap({ ...trayProps, markers: [alice] });
      setSystemTime(new Date("2026-07-19T10:00:11.000Z"));
      await renderNativeMap({ ...trayProps, markers: [aliceMoved] });
      const [tray] =
        root?.container.queryAll((instance) => instance.type === "live-map-people-tray") ?? [];
      const selectAlice = tray?.props["onSelectPerson"] as (userId: string) => void;
      await act(async () => selectAlice("alice"));
      await renderNativeMap({ ...trayProps, markers: [aliceMoved], selectedDeviceId: "alice" });
      emitUserPanAfterProgrammaticCamera();

      const commandsBeforeRetap = getNativeMapCameraCommands().length;
      await act(async () => selectAlice("alice"));
      setSystemTime(new Date("2026-07-19T10:00:12.200Z"));
      await waitForFlyToToEnd();

      expect(setCameraStopsSince(commandsBeforeRetap)).toEqual([
        expect.objectContaining({ animationMode: "flyTo" }),
        {
          animationDuration: 10_800,
          animationMode: "linear",
          centerCoordinate: [-0.12, aliceMoved.latitude],
          padding: expect.any(Object),
        },
      ]);
    });
  });

  test("doesn't swap a followed person's pin for an edge pin, until the map is panned", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    setNativeMapProjectedPoint([600, 300]);
    await renderNativeMap({ markers: [alice], selectedDeviceId: "alice" });
    const views =
      root?.container.queryAll(
        (instance) => instance.type === "view" && typeof instance.props["onLayout"] === "function",
      ) ?? [];
    await act(async () => {
      (views[0]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
      });
      (views[1]?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { width: 44, height: 96, x: 344, y: 56 } },
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(getRenderedOutput()).not.toContain("Go to Alice");

    await act(async () => {
      emitUserPanAfterProgrammaticCamera();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(getRenderedOutput()).toContain("Go to Alice");
  });

  test("focuses the same place again each time it's asked for", async () => {
    const home = {
      canManage: true,
      emoji: "🏠",
      groupId: "family",
      groupName: "Family",
      id: "home",
      latitude: 51.5,
      longitude: -0.12,
      memberUserIds: ["alice"],
      name: "Home",
      radiusMeters: 250,
    };
    const focusHandled = mock(() => {});
    const placeFocusCount = () =>
      getNativeMapCameraCommands().filter(
        (command) =>
          command.type === "setCamera" &&
          JSON.stringify(command.stop).includes('"centerCoordinate":[-0.12,51.5]'),
      ).length;

    for (const focusPlaceId of [null, "home", null, "home"]) {
      await renderNativeMap({ focusPlaceId, onFocusPlaceHandled: focusHandled, places: [home] });
      await flushEffects();
    }

    expect(focusHandled).toHaveBeenCalledTimes(2);
    expect(placeFocusCount()).toBe(2);
  });

  describe("returning after a long time in the background", () => {
    const home = {
      canManage: true,
      emoji: "🏠",
      groupId: "family",
      groupName: "Family",
      id: "home",
      latitude: 51.5,
      longitude: -0.12,
      memberUserIds: ["alice"],
      name: "Home",
      radiusMeters: 250,
    };
    const people = [
      createLiveMapMarkerFixture({ latitude: 51.5, longitude: -0.12, userId: "alice" }),
      createLiveMapMarkerFixture({ latitude: 50.8, longitude: -1.1, userId: "bob" }),
    ];

    const returnAfterTenMinutes = async () => {
      const awayAt = Date.now();
      await act(async () => {
        for (const listener of appStateListeners) listener("background");
      });
      setSystemTime(new Date(awayAt + 10 * 60_000));
      await act(async () => {
        for (const listener of appStateListeners) listener("active");
      });
      await flushEffects();
    };

    const fitsSince = (count: number) =>
      getNativeMapCameraCommands()
        .slice(count)
        .filter((command) => command.type === "fitBounds").length;

    afterEach(() => {
      setSystemTime();
    });

    test("frames everyone again when nothing is open", async () => {
      await renderNativeMap({ markers: people, places: [home] });
      await finishLoadingStyle();
      await flushEffects();
      const before = getNativeMapCameraCommands().length;

      await returnAfterTenMinutes();

      expect(fitsSince(before)).toBe(1);
    });

    test("leaves the map under an open place sheet alone", async () => {
      await renderNativeMap({ markers: people, places: [home] });
      await finishLoadingStyle();
      await flushEffects();
      await renderNativeMap({ focusPlaceId: "home", markers: people, places: [home] });
      await flushEffects();
      await renderNativeMap({ markers: people, places: [home] });
      await flushEffects();
      const before = getNativeMapCameraCommands().length;

      await returnAfterTenMinutes();

      expect(fitsSince(before)).toBe(0);
    });

    test("does not reset the camera while a place focus is waiting for its place", async () => {
      await renderNativeMap({ focusPlaceId: "home", markers: people });
      await finishLoadingStyle();
      await flushEffects();
      const before = getNativeMapCameraCommands().length;

      await returnAfterTenMinutes();
      await renderNativeMap({ focusPlaceId: "home", markers: people, places: [home] });
      await flushEffects();

      expect(fitsSince(before)).toBe(0);
    });
  });

  test("only counts members of the place's group as here now", async () => {
    const timestamp = new Date().toISOString();
    const markers = [
      createLiveMapMarkerFixture({ timestamp, userId: "alice" }),
      createLiveMapMarkerFixture({ name: "Bob", timestamp, userId: "bob" }),
    ];
    const home = {
      canManage: false,
      emoji: "🏠",
      groupId: "family",
      groupName: "Family",
      id: "home",
      latitude: 51.5,
      longitude: -0.12,
      memberUserIds: ["alice"],
      name: "Home",
      radiusMeters: 250,
    };
    await renderNativeMap({ markers, places: [home] });
    await flushEffects();
    await renderNativeMap({ focusPlaceId: "home", markers, places: [home] });
    await flushEffects();

    const sheet = root?.container.queryAll((node) => node.type === "live-map-place-sheet")[0];
    expect(sheet?.props["here"]).toEqual(["alice"]);
  });

  test("heading-only updates do not issue camera commands while following", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });

    await renderNativeMap({
      markers: [alice],
      selectedDeviceId: "alice",
    });
    await flushEffects();

    const commandsAfterFocus = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [alice],
      selectedDeviceId: "alice",
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
      selectedDeviceId: "alice",
    });
    await flushEffects();

    emitUserPanAfterProgrammaticCamera();

    const commandsAfterPan = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [aliceMoved],
      selectedDeviceId: "alice",
    });
    await flushEffects();

    expect(getNativeMapCameraCommands().length).toBe(commandsAfterPan);

    await renderNativeMap({
      markers: [aliceMoved],
      selectedDeviceId: null,
    });
    await flushEffects();
    await renderNativeMap({
      markers: [aliceMoved],
      selectedDeviceId: "alice",
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

  test("policy: Android user pans during follow animation still end follow", async () => {
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
      selectedDeviceId: "alice",
    });
    await flushEffects();

    emitNativeMapRegionIsChanging({
      animated: false,
      isUserInteraction: true,
      latitude: 51.51,
      longitude: -0.13,
      zoomLevel: 14,
    });
    emitNativeMapRegionDidChange({
      animated: false,
      isUserInteraction: true,
      latitude: 51.51,
      longitude: -0.13,
      zoomLevel: 14,
    });

    const commandsAfterPan = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [aliceMoved],
      selectedDeviceId: "alice",
    });
    await flushEffects();

    expect(getNativeMapCameraCommands().length).toBe(commandsAfterPan);
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
      selectedDeviceId: "alice",
    });
    await flushEffects();

    emitNativeMapRegionDidChange(true);

    const commandsAfterQuirk = getNativeMapCameraCommands().length;
    setSystemTime(new Date(Date.now() + 2_000));
    await renderNativeMap({
      markers: [aliceMoved],
      selectedDeviceId: "alice",
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

  test("releases MapLibre's retained focus target before native marker updates can replay it", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });

    await renderNativeMap({
      markers: [alice],
      selectedDeviceId: "alice",
    });
    await flushEffects();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });

    expect(getNativeMapCameraCommands().at(-1)).toEqual({
      type: "setStop",
      stop: {
        duration: 0,
      },
    });

    const commandsAfterRelease = getNativeMapCameraCommands().length;
    setNativeMapSelfHeadingDegrees(90);
    await renderNativeMap({
      markers: [alice],
      selectedDeviceId: "alice",
    });
    await flushEffects();

    expect(getNativeMapCameraCommands()).toHaveLength(commandsAfterRelease);
  });

  test("fits everyone clear of the top chips and the map buttons", async () => {
    const alice = createLiveMapMarkerFixture({ latitude: 51.5, longitude: -0.12, userId: "alice" });
    const bob = createLiveMapMarkerFixture({ latitude: 50.8, longitude: -1.1, userId: "bob" });

    await renderNativeMap({ markers: [alice, bob] });
    await finishLoadingStyle();
    await flushEffects();
    const chips = root?.container.queryAll(
      (node) =>
        node.type === "view" &&
        typeof node.props["onLayout"] === "function" &&
        node.queryAll(
          (child) => child.type === "pressable" && child.props["accessibilityLabel"] === "People",
        ).length > 0,
    );
    await act(async () => {
      (chips?.at(-1)?.props["onLayout"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { layout: { height: 88, width: 380, x: 12, y: 8 } },
      });
    });
    emitNativeMapShowEveryone();
    await flushEffects();

    const fits = getNativeMapCameraCommands().filter((command) => command.type === "fitBounds");
    expect(fits.map((command) => command.padding)).toEqual([
      [76, 88, 48, 32],
      [124, 88, 48, 32],
    ]);
  });

  test("releases MapLibre's retained Show everyone bounds before native marker updates can replay them", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });
    const bob = createLiveMapMarkerFixture({
      latitude: 50.8,
      longitude: -1.1,
      userId: "bob",
    });

    await renderNativeMap({ markers: [alice, bob] });
    await flushEffects();

    emitNativeMapShowEveryone();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(getNativeMapCameraCommands().at(-1)).toEqual({
      type: "setStop",
      stop: {
        duration: 0,
      },
    });

    const commandsAfterRelease = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [
        alice,
        createLiveMapMarkerFixture({
          ...bob,
          latitude: 50.81,
          longitude: -1.09,
        }),
      ],
    });
    await flushEffects();

    expect(getNativeMapCameraCommands()).toHaveLength(commandsAfterRelease);
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
      selectedDeviceId: "self",
    });
    await flushEffects();

    const commandsAfterSelection = getNativeMapCameraCommands().length;
    await renderNativeMap({
      markers: [self, alice],
      selectedDeviceId: "self",
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
      onSelectDeviceId: (userId) => {
        selections.push(userId);
      },
      selectedDeviceId: "alice",
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

  test("Go to current location selects self and flies to lock on", async () => {
    const self = createLiveMapMarkerFixture({
      initials: "ME",
      isSelf: true,
      latitude: 51.5074,
      longitude: -0.1278,
      name: "Me",
      userId: "self",
    });
    const alice = createLiveMapMarkerFixture({
      latitude: 50.8,
      longitude: -1.1,
      userId: "alice",
    });
    const selections: Array<string | null> = [];

    await renderNativeMap({
      markers: [self, alice],
      onSelectDeviceId: (userId) => {
        selections.push(userId);
      },
    });
    await flushEffects();

    const commandsBeforeGoToCurrentLocation = getNativeMapCameraCommands().length;
    emitNativeMapGoToCurrentLocation();

    expect(selections).toEqual(["self"]);
    expect(getNativeMapCameraCommands().slice(commandsBeforeGoToCurrentLocation)).toEqual(
      expect.arrayContaining([
        {
          type: "setCamera",
          stop: {
            animationDuration: 1200,
            animationMode: "flyTo",
            centerCoordinate: [-0.1278, 51.5074],
            padding: {
              paddingBottom: 220,
              paddingLeft: 32,
              paddingRight: 32,
              paddingTop: 56,
            },
            zoomLevel: 15,
          },
        },
      ]),
    );
  });

  test("Go to current location is unavailable without a self marker", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    const commandsBeforeGoToCurrentLocation = getNativeMapCameraCommands().length;
    emitNativeMapGoToCurrentLocation();

    expect(getNativeMapCameraCommands()).toHaveLength(commandsBeforeGoToCurrentLocation);
  });

  test("Go to current location re-locks after panning without deselecting self", async () => {
    const self = createLiveMapMarkerFixture({
      initials: "ME",
      isSelf: true,
      latitude: 51.5074,
      longitude: -0.1278,
      name: "Me",
      userId: "self",
    });
    const selections: Array<string | null> = [];

    await renderNativeMap({
      markers: [self],
      onSelectDeviceId: (userId) => {
        selections.push(userId);
      },
      selectedDeviceId: "self",
    });
    await flushEffects();

    emitNativeMapRegionDidChange({
      animated: false,
      isUserInteraction: true,
      latitude: 50,
      longitude: -1,
      zoomLevel: 10,
    });

    const commandsBeforeGoToCurrentLocation = getNativeMapCameraCommands().length;
    emitNativeMapGoToCurrentLocation();

    expect(selections).toEqual([]);
    expect(
      getNativeMapCameraCommands()
        .slice(commandsBeforeGoToCurrentLocation)
        .some(
          (command) =>
            command.type === "setCamera" &&
            (command.stop as { centerCoordinate?: [number, number] }).centerCoordinate?.[0] ===
              -0.1278 &&
            (command.stop as { centerCoordinate?: [number, number] }).centerCoordinate?.[1] ===
              51.5074,
        ),
    ).toBe(true);
  });

  test("drives annotation select and map-background press through NativeMap", async () => {
    const selections: Array<string | null> = [];
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const bob = createLiveMapMarkerFixture({
      initials: "BO",
      latitude: 40,
      longitude: 20,
      name: "Bob",
      userId: "bob",
    });

    await renderNativeMap({
      markers: [alice, bob],
      onSelectDeviceId: (userId) => {
        selections.push(userId);
      },
    });

    expect(getNativeMapMountedAnnotationIds().sort()).toEqual(["alice", "bob"]);

    emitNativeMapIosAnnotationTap("alice");
    emitNativeMapPress();
    emitNativeMapIosAnnotationTap("bob");

    expect(selections).toEqual(["alice", null, "bob"]);
  });

  test("shows a single stack for people in the same place and lists them when tapped", async () => {
    testPlatform.OS = "android";
    const selectionHistory: Array<string | null> = [];
    await renderSelectableNativeMap(
      [
        createLiveMapMarkerFixture({ userId: "alice", name: "Alice" }),
        createLiveMapMarkerFixture({ userId: "bob", name: "Bob" }),
      ],
      selectionHistory,
    );

    const [stackId, ...others] = getNativeMapMountedAnnotationIds();
    expect(others).toEqual([]);
    await act(async () => emitNativeMapAndroidMarkerTap(stackId ?? ""));

    expect(
      root?.container.queryAll((instance) => instance.type === "live-map-stack-sheet")[0]?.props,
    ).toMatchObject({ count: 2 });
    expect(selectionHistory.filter((deviceId) => deviceId !== null)).toEqual([]);
  });

  test("closes a stack sheet for good when another action takes over", async () => {
    testPlatform.OS = "android";
    await renderSelectableNativeMap(
      [
        createLiveMapMarkerFixture({ userId: "alice", name: "Alice", isSelf: true }),
        createLiveMapMarkerFixture({ userId: "bob", name: "Bob" }),
      ],
      [],
    );
    const stackSheets = () =>
      root?.container.queryAll((instance) => instance.type === "live-map-stack-sheet") ?? [];
    const [stackId] = getNativeMapMountedAnnotationIds();
    await act(async () => emitNativeMapAndroidMarkerTap(stackId ?? ""));
    expect(stackSheets()).toHaveLength(1);

    await act(async () => emitNativeMapGoToCurrentLocation());
    await flushEffects();
    expect(stackSheets()).toHaveLength(0);

    await act(async () => emitNativeMapPress([300, 400]));
    await flushEffects();
    expect(stackSheets()).toHaveLength(0);
  });

  test("Android draws pins inside the map, toggles a tapped person and ignores the map press that follows", async () => {
    testPlatform.OS = "android";
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const bob = createLiveMapMarkerFixture({
      latitude: 40,
      longitude: 20,
      userId: "bob",
      name: "Bob",
    });
    const selectionHistory: Array<string | null> = [];
    const startedAt = Date.now();
    setSystemTime(new Date(startedAt));
    await renderSelectableNativeMap([alice, bob], selectionHistory);

    expect(getNativeMapMountedAnnotationIds().sort()).toEqual(["alice", "bob"]);

    const tap = async (id: string) => {
      await act(async () => {
        emitNativeMapAndroidMarkerTap(id);
        await Promise.resolve();
      });
      await flushEffects();
    };
    await tap("alice");
    await tap("alice");
    await tap("alice");
    await tap("bob");
    expect(selectionHistory).toEqual(["alice", null, "alice", "bob"]);

    setSystemTime(new Date(startedAt + 600));
    await act(async () => emitNativeMapPress([300, 400]));
    expect(selectionHistory).toEqual(["alice", null, "alice", "bob", null]);
  });

  test("Android keeps a tapped place open through the map press that follows", async () => {
    testPlatform.OS = "android";
    const home = {
      canManage: true,
      emoji: "🏠",
      groupId: "family",
      groupName: "Family",
      id: "home",
      latitude: 51.5,
      longitude: -0.12,
      memberUserIds: ["alice"],
      name: "Home",
      radiusMeters: 250,
    };
    setSystemTime(new Date(Date.now()));
    await renderNativeMap({ places: [home] });
    await flushEffects();
    const placeSheets = () =>
      root?.container.queryAll((node) => node.type === "live-map-place-sheet") ?? [];
    expect(placeSheets()).toHaveLength(0);

    await act(async () => emitNativeMapAndroidMarkerTap("place:family:home"));
    await flushEffects();

    expect(placeSheets()).toHaveLength(1);
  });

  test("refreshes a stack's drawing when the people in it change", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice", name: "Alice" });
    const bob = createLiveMapMarkerFixture({ userId: "bob", name: "Bob" });
    await renderNativeMap({ markers: [alice, bob] });
    await flushEffects();
    const [stackId] = getNativeMapMountedAnnotationIds();
    const stackRefreshes = () =>
      getNativeMapAnnotationRefreshCalls().filter((id) => id === stackId).length;
    const refreshesWithTwo = stackRefreshes();
    expect(refreshesWithTwo).toBeGreaterThan(0);

    await renderNativeMap({
      markers: [alice, bob, createLiveMapMarkerFixture({ userId: "carol", name: "Carol" })],
    });
    await flushEffects();

    expect(getNativeMapMountedAnnotationIds()).toEqual([stackId ?? ""]);
    expect(stackRefreshes()).toBeGreaterThan(refreshesWithTwo);
  });

  test("iOS toggles a tapped person, switches people in one tap and closes on a map press", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const bob = createLiveMapMarkerFixture({
      latitude: 40,
      longitude: 20,
      userId: "bob",
      name: "Bob",
    });
    const selectionHistory: Array<string | null> = [];
    await renderSelectableNativeMap([alice, bob], selectionHistory);

    const tap = async (id: string) => {
      await act(async () => {
        emitNativeMapIosAnnotationTap(id);
        await Promise.resolve();
      });
      await flushEffects();
    };
    await tap("alice");
    await tap("alice");
    await tap("alice");
    await tap("bob");
    expect(selectionHistory).toEqual(["alice", null, "alice", "bob"]);

    await act(async () => emitNativeMapPress([300, 400]));
    await flushEffects();
    await tap("bob");
    expect(selectionHistory).toEqual(["alice", null, "alice", "bob", null, "bob"]);
  });

  test("does not pass a controlled selected prop to annotations", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });

    await renderNativeMap({
      markers: [alice],
      selectedDeviceId: "alice",
    });

    expect(getNativeMapAnnotationSelectedProp("alice")).toBeUndefined();
  });

  test("redraws the Android self pin once its heading moves by five degrees", async () => {
    testPlatform.OS = "android";
    const self = createLiveMapMarkerFixture({
      initials: "ME",
      isSelf: true,
      name: "Me",
      userId: "self",
    });

    const selfRefreshes = () =>
      getNativeMapAnnotationRefreshCalls().filter((id) => id === "self").length;
    const showHeading = async (headingDegrees: number) => {
      await act(async () => {
        await Promise.resolve();
        setNativeMapSelfHeadingDegrees(headingDegrees);
        root?.render(<NativeMap markers={[self]} />);
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    setNativeMapSelfHeadingDegrees(10);
    await renderNativeMap({ markers: [self] });
    await flushEffects();
    const refreshCountAfterMount = selfRefreshes();
    expect(refreshCountAfterMount).toBeGreaterThan(0);

    await showHeading(11.5);
    expect(selfRefreshes()).toBe(refreshCountAfterMount);

    await showHeading(16);
    expect(selfRefreshes()).toBeGreaterThan(refreshCountAfterMount);
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

  test("draws the last map from the phone's cache while the map link can't be fetched", async () => {
    const sourceUrl = "https://tiles.example.com/planet-a.pmtiles?archive=a-20261001";
    lastMapSource = { archiveId: "a-20261001", sourceUrl };
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: null,
      isLoading: false,
      isPaused: true,
    };
    await renderNativeMap();
    await flushEffects();
    expect(getNativeMapStyle()).toMatchObject({ pmtilesUrl: sourceUrl });
    expect(getNativeMapUrlTransforms()).toEqual([]);

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "a-20261001",
        url: "https://tiles.example.com/planet-a.pmtiles?sig=1",
      },
      isLoading: false,
      isPaused: false,
    };
    await renderNativeMap();
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapStyle()).toMatchObject({ pmtilesUrl: sourceUrl });
    expect(getNativeMapUrlTransforms().at(-1)?.replace).toBe(
      "https://tiles.example.com/planet-a.pmtiles?sig=1",
    );
    expect(cachedTileClears).toBe(0);
  });

  test("reloads the saved map once a signed link arrives after a failed fetch", async () => {
    const sourceUrl = "https://tiles.example.com/planet-a.pmtiles?archive=a-20261001";
    lastMapSource = { archiveId: "a-20261001", sourceUrl };
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: null,
      failureCount: 1,
      isFetching: true,
      isLoading: true,
    };
    await renderNativeMap();
    await flushEffects();
    expect(getNativeMapStyle()).toMatchObject({ pmtilesUrl: sourceUrl });
    emitNativeMapRegionDidChange({ latitude: 51.51, longitude: -0.13, zoomLevel: 12.5 });
    expect(getNativeMapViewMountCount()).toBe(1);

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "a-20261001",
        url: "https://tiles.example.com/planet-a.pmtiles?sig=1",
      },
      failureCount: 0,
      isFetching: false,
      isLoading: false,
    };
    await renderNativeMap();
    await flushEffects();
    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapStyle()).toMatchObject({ pmtilesUrl: sourceUrl });
    expect(getNativeMapCameraDefaultSettings()).toEqual({
      centerCoordinate: [-0.13, 51.51],
      zoomLevel: 12.5,
    });
    expect(cachedTileClears).toBe(0);

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "a-20261001",
        url: "https://tiles.example.com/planet-a.pmtiles?sig=2",
      },
    };
    await renderNativeMap();
    await flushEffects();
    expect(getNativeMapViewMountCount()).toBe(2);
  });

  test("falls back to the last map once fetching the map link has failed", async () => {
    const sourceUrl = "https://tiles.example.com/planet-a.pmtiles?archive=a-20261001";
    lastMapSource = { archiveId: "a-20261001", sourceUrl };
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: null,
      isLoading: true,
    };
    await renderNativeMap();
    expect(getRenderedOutput()).toContain("activity-indicator");
    expect(getRenderedOutput()).not.toContain("map-view");

    currentSignedPmtilesUrlQuery = { ...currentSignedPmtilesUrlQuery, failureCount: 1 };
    await renderNativeMap();
    await flushEffects();
    expect(getNativeMapStyle()).toMatchObject({ pmtilesUrl: sourceUrl });
  });

  test("says the map needs a connection when offline with no map saved on the phone", async () => {
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: null,
      isLoading: false,
      isPaused: true,
    };
    await renderNativeMap();
    expect(getRenderedOutput()).toContain(
      "You’re offline. The map will appear when you reconnect.",
    );
    expect(getRenderedOutput()).not.toContain("activity-indicator");
    expect(getRenderedOutput()).not.toContain("map-view");
  });

  test("saves the map source it draws so the next launch can start offline", async () => {
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "a-20261001",
        url: "https://tiles.example.com/planet-a.pmtiles?sig=1",
      },
    };
    await renderNativeMap();
    await flushEffects();
    expect(savedMapSources.at(-1)).toEqual({
      archiveId: "a-20261001",
      sourceUrl: "https://tiles.example.com/planet-a.pmtiles?archive=a-20261001",
    });
  });

  test("clears cached map tiles when the server switches to a new map", async () => {
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "a-20261001",
        url: "https://t.example/a.pmtiles?s=1",
      },
    };
    await renderNativeMap();
    await flushEffects();
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "a-20261001",
        url: "https://t.example/a.pmtiles?s=2",
      },
    };
    await renderNativeMap();
    await flushEffects();
    expect(cachedTileClears).toBe(0);

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "b-20261101",
        url: "https://t.example/b.pmtiles?s=3",
      },
    };
    await renderNativeMap();
    await flushEffects();
    expect(cachedTileClears).toBe(1);
  });

  test("clears cached map tiles once when a forced refresh switches to a new map", async () => {
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "a-20261001",
        url: "https://t.example/a.pmtiles?s=1",
      },
    };
    forceRefreshArchiveId = "b-20261101";
    forceRefreshUrl = "https://t.example/b.pmtiles?s=2";
    await renderNativeMap();
    await flushEffects();
    await failMapLoad();
    await flushEffects();
    expect(forceRefreshMutationCalls).toBe(1);
    expect(cachedTileClears).toBe(1);
    expect(getNativeMapViewMountCount()).toBe(2);

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, archiveId: "b-20261101", url: forceRefreshUrl },
    };
    await renderNativeMap();
    await flushEffects();
    expect(cachedTileClears).toBe(1);
    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapStyle()).toMatchObject({
      pmtilesUrl: "https://t.example/b.pmtiles?archive=b-20261101",
    });
  });

  test("clears cached map tiles when the map changed while the app was closed", async () => {
    lastMapSource = {
      archiveId: "a-20261001",
      sourceUrl: "https://t.example/a.pmtiles?archive=a-20261001",
    };
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        ...defaultSignedUrl,
        archiveId: "b-20261101",
        url: "https://t.example/b.pmtiles?s=1",
      },
    };
    await renderNativeMap();
    await flushEffects();
    expect(cachedTileClears).toBe(1);
    expect(getNativeMapStyle()).toMatchObject({
      pmtilesUrl: "https://t.example/b.pmtiles?archive=b-20261101",
    });
  });

  test("rotates the signed archive URL without replacing the map style", async () => {
    const firstUrl = "https://tiles.example.com/maps/world.pmtiles?signature=first";
    const nextUrl = "https://tiles.example.com/maps/world.pmtiles?signature=second";
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, url: firstUrl },
    };
    await renderNativeMap();
    await flushEffects();
    const initialStyle = getNativeMapStyle();
    const firstTransform = getNativeMapUrlTransforms().at(-1)!;
    expect(
      new RegExp(firstTransform.find).test("https://tiles.example.com/maps/world.pmtiles"),
    ).toBe(true);
    expect(
      new RegExp(firstTransform.find).test("https://tilesXexample.com/maps/world.pmtiles"),
    ).toBe(false);
    expect(firstTransform.replace).toBe(firstUrl);

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, url: nextUrl },
    };
    await renderNativeMap();
    await flushEffects();
    expect(getNativeMapUrlTransforms().at(-1)?.replace).toBe(nextUrl);
    expect(getNativeMapStyle()).toEqual(initialStyle);
    expect(getNativeMapViewMountCount()).toBe(1);
  });

  test("remounts on a new archive and keeps signing the old archive until the old map unmounts", async () => {
    const oldUrl = "https://tiles.example.com/planet-a.pmtiles";
    const newUrl = "https://tiles.example.com/planet-b.pmtiles";
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, archiveId: "a-20261001", url: `${oldUrl}?sig=1` },
    };
    await renderNativeMap();
    await flushEffects();

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, archiveId: "b-20261101", url: `${newUrl}?sig=2` },
    };
    await renderNativeMap();
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapUrlTransformEvents()).toEqual([
      `add:openbeacon-pmtiles:${oldUrl}?archive=a-20261001`,
      `add:openbeacon-pmtiles:${newUrl}?archive=b-20261101`,
      `remove:openbeacon-pmtiles:${oldUrl}?archive=a-20261001:liveMaps=0`,
    ]);
  });

  test("treats a new build in the same slot as a new source", async () => {
    const slotUrl = "https://tiles.example.com/planet-b.pmtiles";
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, archiveId: "b-20261001", url: `${slotUrl}?sig=1` },
    };
    await renderNativeMap();
    await flushEffects();

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, archiveId: "b-20261201", url: `${slotUrl}?sig=2` },
    };
    await renderNativeMap();
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapUrlTransformEvents()).toEqual([
      `add:openbeacon-pmtiles:${slotUrl}?archive=b-20261001`,
      `add:openbeacon-pmtiles:${slotUrl}?archive=b-20261201`,
      `remove:openbeacon-pmtiles:${slotUrl}?archive=b-20261001:liveMaps=0`,
    ]);
  });

  test("keeps the map and its style when only the pmtiles signature changes", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice" });

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapStyle()).toMatchObject({
      pmtilesUrl: "https://cached.example/pmtiles-1",
      version: 8,
    });

    emitNativeMapRegionDidChange({
      latitude: 51.5,
      longitude: -0.12,
      zoomLevel: 14,
    });

    const cameraCommandsBeforeRefresh = getNativeMapCameraCommands().length;
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: {
        expiresAt: "2026-03-31T12:30:00.000Z",
        refreshAt: "2026-03-31T12:29:00.000Z",
        url: "https://cached.example/pmtiles-1?signature=refreshed",
      },
    };

    await renderNativeMap({ markers: [alice] });
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapStyle()).toMatchObject({
      pmtilesUrl: "https://cached.example/pmtiles-1",
      version: 8,
    });
    expect(getNativeMapCameraCommands().length).toBe(cameraCommandsBeforeRefresh);
  });

  describe("groups on the map", () => {
    const family = {
      color: "#FF1464",
      hidden: false,
      id: "family",
      memberCount: 3,
      name: "Family",
    };
    const club = { color: "#2A9D8F", hidden: false, id: "club", memberCount: 4, name: "Club" };
    const emptyPeople: MapPeople = {
      cantLocate: [],
      cantRead: [],
      finding: [],
      hidden: [],
      outOfDate: [],
      paused: [],
      upToDate: [],
      waiting: [],
      waitingForLocation: [],
    };
    const findOne = (type: string) =>
      root?.container.queryAll((instance) => instance.type === type)[0];
    const groupsButton = () =>
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" &&
          String(instance.props["accessibilityLabel"]).startsWith("Groups on the map"),
      )[0];
    const press = async (
      instance: { props: Record<string, unknown> } | undefined,
      key = "onPress",
    ) => act(async () => (instance?.props[key] as (() => void) | undefined)?.());

    test("only shows the groups button for people in two or more groups", async () => {
      await renderNativeMap({ groupOptions: [family] });
      expect(groupsButton()).toBeUndefined();

      await renderNativeMap({ groupOptions: [family, club] });
      expect(groupsButton()?.props["accessibilityLabel"]).toBe("Groups on the map");

      await renderNativeMap({ groupOptions: [family, { ...club, hidden: true }] });
      expect(groupsButton()?.props["accessibilityLabel"]).toBe("Groups on the map, 1 hidden");
    });

    test("hides a group from the menu, then undoes it from the toast", async () => {
      const changes: Array<[string, boolean]> = [];
      const onSetGroupHidden = (groupId: string, hidden: boolean) => {
        changes.push([groupId, hidden]);
      };
      await renderNativeMap({ groupOptions: [family, club], onSetGroupHidden });

      await press(groupsButton());
      await act(async () =>
        (
          findOne("live-map-group-menu")?.props["onSetHidden"] as
            ((groupId: string, hidden: boolean) => void) | undefined
        )?.("club", true),
      );
      expect(changes).toEqual([["club", true]]);
      expect(findOne("live-map-hidden-groups-notice")?.props["toastGroupNames"]).toEqual(["Club"]);
      expect(accessibilityAnnouncements).toEqual([
        "Club hidden. You’re still sharing your location with them.",
      ]);

      await press(findOne("live-map-hidden-groups-notice"), "onUndo");
      expect(changes).toEqual([
        ["club", true],
        ["club", false],
      ]);
      expect(findOne("live-map-hidden-groups-notice")).toBeUndefined();
    });

    test("collects groups hidden in a row into one toast and undoes them all", async () => {
      const school = { ...club, id: "school", name: "School" };
      const changes: Array<[string, boolean]> = [];
      await renderNativeMap({
        groupOptions: [family, club, school],
        onSetGroupHidden: (groupId, hidden) => {
          changes.push([groupId, hidden]);
        },
      });

      await press(groupsButton());
      const setHidden = (groupId: string) =>
        act(async () =>
          (
            findOne("live-map-group-menu")?.props["onSetHidden"] as
              ((groupId: string, hidden: boolean) => void) | undefined
          )?.(groupId, true),
        );
      await setHidden("club");
      await setHidden("school");
      expect(findOne("live-map-hidden-groups-notice")?.props["toastGroupNames"]).toEqual([
        "Club",
        "School",
      ]);

      await press(findOne("live-map-hidden-groups-notice"), "onUndo");
      expect(changes).toEqual([
        ["club", true],
        ["school", true],
        ["club", false],
        ["school", false],
      ]);
    });

    test("closes the menu when a person or stack is tapped", async () => {
      const alice = createLiveMapMarkerFixture({ userId: "alice", name: "Alice" });
      await renderNativeMap({ groupOptions: [family, club], markers: [alice] });

      await press(groupsButton());
      expect(findOne("live-map-group-menu")).toBeDefined();
      await act(async () => emitNativeMapIosAnnotationTap("alice"));
      expect(findOne("live-map-group-menu")).toBeUndefined();

      testPlatform.OS = "android";
      await renderNativeMap({
        groupOptions: [family, club],
        markers: [alice, createLiveMapMarkerFixture({ userId: "bob", name: "Bob" })],
      });
      await press(groupsButton());
      expect(findOne("live-map-group-menu")).toBeDefined();
      const [stackId] = getNativeMapMountedAnnotationIds();
      await act(async () => emitNativeMapAndroidMarkerTap(stackId ?? ""));
      expect(findOne("live-map-group-menu")).toBeUndefined();
    });

    test("closes the menu with the Android back button only while it is open", async () => {
      await renderNativeMap({ groupOptions: [family, club] });
      expect(backPressListeners.size).toBe(0);

      await press(groupsButton());
      const [onBackPress] = backPressListeners;
      let handled = false;
      await act(async () => {
        handled = onBackPress?.() ?? false;
      });
      expect(handled).toBe(true);
      expect(findOne("live-map-group-menu")).toBeUndefined();
      expect(backPressListeners.size).toBe(0);
    });

    test("opens the menu from the hidden groups pill and closes it when the map is tapped", async () => {
      await renderNativeMap({ groupOptions: [family, { ...club, hidden: true }] });
      expect(findOne("live-map-group-menu")).toBeUndefined();

      await press(findOne("live-map-hidden-groups-notice"), "onOpenMenu");
      expect(findOne("live-map-group-menu")).toBeDefined();
      expect(findOne("live-map-hidden-groups-notice")).toBeUndefined();

      await act(async () => emitNativeMapPress());
      expect(findOne("live-map-group-menu")).toBeUndefined();
    });

    test("shows a hidden person's group again from their sheet", async () => {
      const changes: Array<[string, boolean]> = [];
      const tom = {
        groupNames: ["Club"],
        hiddenGroups: [{ id: "club", name: "Club" }],
        image: null,
        initials: "To",
        isSelf: false,
        name: "Tom",
        userId: "tom",
      };
      await renderNativeMap({
        groupOptions: [family, { ...club, hidden: true }],
        onSetGroupHidden: (groupId, hidden) => {
          changes.push([groupId, hidden]);
        },
        people: { ...emptyPeople, hidden: [tom] },
        peopleTrayOpen: true,
      });

      await act(async () =>
        (
          findOne("live-map-people-tray")?.props["onSelectPerson"] as
            ((userId: string) => void) | undefined
        )?.("tom"),
      );
      const sheet = findOne("live-map-missing-person-sheet");
      expect(sheet?.props["name"]).toBe("Tom");

      await act(async () =>
        (sheet?.props["onShowGroup"] as ((groupId: string) => void) | undefined)?.("club"),
      );
      expect(changes).toEqual([["club", false]]);
    });
  });

  describe("people tray", () => {
    const person = (userId: string, name: string): MapPerson => ({
      groupNames: ["Family"],
      image: null,
      initials: name.slice(0, 2).toUpperCase(),
      isSelf: false,
      name,
      userId,
    });
    const createPeople = (overrides: Partial<MapPeople> = {}): MapPeople => ({
      cantLocate: [],
      cantRead: [],
      finding: [],
      hidden: [],
      outOfDate: [],
      paused: [],
      upToDate: [],
      waiting: [],
      waitingForLocation: [],
      ...overrides,
    });
    const peopleButton = () =>
      root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" &&
          String(instance.props["accessibilityLabel"]).startsWith("People"),
      )[0];
    const trays = () =>
      root?.container.queryAll((instance) => instance.type === "live-map-people-tray") ?? [];

    test("shows the people button before membership has loaded", async () => {
      await renderNativeMap();

      expect(peopleButton()?.props["accessibilityLabel"]).toBe("People");
    });

    test("opens the tray from the people button once people are known", async () => {
      const openChanges: boolean[] = [];
      const onPeopleTrayOpenChange = (open: boolean) => {
        openChanges.push(open);
      };
      await renderNativeMap({ onPeopleTrayOpenChange });

      await act(async () => (peopleButton()?.props["onPress"] as (() => void) | undefined)?.());
      expect(openChanges).toEqual([true]);

      await renderNativeMap({ onPeopleTrayOpenChange, peopleTrayOpen: true });
      expect(trays()).toHaveLength(0);

      await renderNativeMap({
        onPeopleTrayOpenChange,
        people: createPeople({ cantLocate: [person("bob", "Bob")] }),
        peopleTrayOpen: true,
      });
      expect(trays()).toHaveLength(1);

      await act(async () => (peopleButton()?.props["onPress"] as (() => void) | undefined)?.());
      expect(openChanges).toEqual([true, false]);
    });

    test("hides the tray while a person sheet is open", async () => {
      const alice = createLiveMapMarkerFixture({ userId: "alice" });
      await renderNativeMap({
        markers: [alice],
        people: createPeople({ upToDate: [alice] }),
        peopleTrayOpen: true,
        selectedDeviceId: "alice",
      });

      expect(trays()).toHaveLength(0);
      expect(
        root?.container.queryAll((instance) => instance.type === "live-map-person-sheet"),
      ).toHaveLength(1);
    });

    test("counts people who can't be located or read once nobody is still being found", async () => {
      const unreadable = { ...person("carol", "Carol"), groupId: "g1", groupName: "Family" };
      const needsAttention = {
        cantLocate: [person("bob", "Bob")],
        cantRead: [{ ...unreadable, reason: "groupKey" as const }],
      };

      await renderNativeMap({
        people: createPeople({ ...needsAttention, finding: [person("dan", "Dan")] }),
      });
      expect(peopleButton()?.props["accessibilityLabel"]).toBe("People");

      await renderNativeMap({
        people: createPeople({
          ...needsAttention,
          waitingForLocation: [{ ...person("fred", "Fred"), waitingForLocation: true }],
        }),
      });
      expect(peopleButton()?.props["accessibilityLabel"]).toBe("People, 2 need attention");

      const erin = createLiveMapMarkerFixture({
        unreadableGroup: { id: "g1", name: "Family" },
        userId: "erin",
      });
      await renderNativeMap({
        markers: [erin],
        people: createPeople({ outOfDate: [erin] }),
      });
      expect(peopleButton()?.props["accessibilityLabel"]).toBe("People, 1 need attention");
    });

    test("swaps the missing-person sheet for the person sheet when they get a location", async () => {
      const selections: Array<string | null> = [];
      const onSelectDeviceId = (userId: string | null) => {
        selections.push(userId);
      };
      const bob = person("bob", "Bob");
      await renderNativeMap({
        onSelectDeviceId,
        people: createPeople({ cantLocate: [bob] }),
        peopleTrayOpen: true,
      });
      await act(async () =>
        (trays()[0]?.props["onSelectPerson"] as ((userId: string) => void) | undefined)?.("bob"),
      );
      const missingSheets = () =>
        root?.container.queryAll((instance) => instance.type === "live-map-missing-person-sheet") ??
        [];
      expect(missingSheets()).toHaveLength(1);
      expect(trays()).toHaveLength(0);

      const bobMarker = createLiveMapMarkerFixture({ userId: "bob", name: "Bob" });
      await renderNativeMap({
        markers: [bobMarker],
        onSelectDeviceId,
        people: createPeople({ upToDate: [bobMarker] }),
        peopleTrayOpen: true,
      });
      await flushEffects();

      expect(missingSheets()).toHaveLength(0);
      expect(selections.at(-1)).toBe("bob");
      expect(
        getNativeMapCameraCommands().some(
          (command) =>
            command.type === "setCamera" &&
            (command.stop as { centerCoordinate?: [number, number] }).centerCoordinate?.[0] ===
              bobMarker.longitude,
        ),
      ).toBe(true);
    });
  });

  describe("asking for an update", () => {
    const device = (
      overrides: Partial<{
        paused: boolean;
        platform: "android" | "ios" | null;
        userId: string;
      }> & {
        deviceId: string;
      },
    ) => ({
      icon: "phone" as const,
      name: "Phone",
      paused: false,
      platform: "android" as const,
      unreadable: false,
      userId: "alice",
      ...overrides,
    });

    test.each([
      ["has an Android phone", [device({ deviceId: "a1" })], undefined, true],
      ["joined after this phone last loaded the group's devices", [], undefined, true],
      [
        "has an iPhone and an Android phone",
        [device({ deviceId: "a1", platform: "ios" }), device({ deviceId: "a2" })],
        undefined,
        true,
      ],
      [
        "has paused one of two phones",
        [device({ deviceId: "a1", paused: true }), device({ deviceId: "a2" })],
        undefined,
        true,
      ],
      [
        "has only paused phones",
        [device({ deviceId: "a1", paused: true }), device({ deviceId: "a2", paused: true })],
        undefined,
        false,
      ],
      [
        "has only an iPhone and iPad",
        [device({ deviceId: "a1", platform: "ios" }), device({ deviceId: "a2", platform: "ios" })],
        undefined,
        false,
      ],
      [
        "has paused their Android phone and only their iPhone is sharing",
        [device({ deviceId: "a1", paused: true }), device({ deviceId: "a2", platform: "ios" })],
        undefined,
        false,
      ],
      [
        "has one phone whose newer locations can't be read",
        [device({ deviceId: "a1" })],
        { id: "group-1", name: "Family" },
        false,
      ],
      [
        "has two phones and one can't be read",
        [device({ deviceId: "a1" }), device({ deviceId: "a2" })],
        { id: "group-1", name: "Family" },
        true,
      ],
    ] as const)("someone who %s can be asked: %p", async (_, devices, unreadableGroup, shown) => {
      const alice = createLiveMapMarkerFixture({
        deviceId: "a1",
        userId: "alice",
        ...(unreadableGroup ? { unreadableGroup } : {}),
      });
      await renderNativeMap({
        devices,
        markers: [alice],
        onRequestUpdate: async () => {},
        selectedDeviceId: "a1",
      });
      const [sheet] =
        root?.container.queryAll((instance) => instance.type === "live-map-person-sheet") ?? [];
      expect(sheet?.props["canRequestUpdate"]).toBe(shown);
    });

    test("nobody can be asked when the server can't wake phones", async () => {
      const alice = createLiveMapMarkerFixture({ deviceId: "a1", userId: "alice" });
      await renderNativeMap({
        devices: [device({ deviceId: "a1" })],
        markers: [alice],
        selectedDeviceId: "a1",
      });
      const [sheet] =
        root?.container.queryAll((instance) => instance.type === "live-map-person-sheet") ?? [];
      expect(sheet?.props["canRequestUpdate"]).toBe(false);
    });

    describe("someone with no location on the map", () => {
      const alice = {
        groupNames: ["Family"],
        image: null,
        initials: "Al",
        isSelf: false,
        name: "Alice",
        userId: "alice",
      };
      const noPeople: MapPeople = {
        cantLocate: [],
        cantRead: [],
        finding: [],
        hidden: [],
        outOfDate: [],
        paused: [],
        upToDate: [],
        waiting: [],
        waitingForLocation: [],
      };
      const unreadable = {
        ...alice,
        groupId: "group-1",
        groupName: "Family",
        reason: "point" as const,
      };

      const openMissingSheet = async ({
        devices,
        onRequestUpdate = async () => {},
        people,
      }: {
        devices: readonly ReturnType<typeof device>[];
        onRequestUpdate?: (userId: string) => Promise<void>;
        people: Partial<MapPeople>;
      }) => {
        await renderNativeMap({
          devices,
          onRequestUpdate,
          people: { ...noPeople, ...people },
          peopleTrayOpen: true,
        });
        const [tray] =
          root?.container.queryAll((instance) => instance.type === "live-map-people-tray") ?? [];
        await act(async () =>
          (tray?.props["onSelectPerson"] as ((userId: string) => void) | undefined)?.("alice"),
        );
        const [sheet] =
          root?.container.queryAll(
            (instance) => instance.type === "live-map-missing-person-sheet",
          ) ?? [];
        if (!sheet) throw new Error("Missing-person sheet didn't open");
        return sheet;
      };

      test.each<[string, Partial<MapPeople>, ReturnType<typeof device>[], boolean]>([
        ["whose location is unknown", { cantLocate: [alice] }, [device({ deviceId: "a1" })], true],
        ["whose devices haven't loaded yet", { cantLocate: [alice] }, [], true],
        [
          "who has just turned sharing back on",
          { waitingForLocation: [{ ...alice, waitingForLocation: true as const }] },
          [device({ deviceId: "a1" })],
          true,
        ],
        [
          "whose location is unknown and who only has an iPhone",
          { cantLocate: [alice] },
          [device({ deviceId: "a1", platform: "ios" })],
          false,
        ],
        [
          "whose location is unknown and whose phones are all paused",
          { cantLocate: [alice] },
          [device({ deviceId: "a1", paused: true }), device({ deviceId: "a2", paused: true })],
          false,
        ],
        [
          "who has paused sharing",
          { paused: [{ ...alice, sharingPaused: true as const, timelineGroupId: "group-1" }] },
          [device({ deviceId: "a1" })],
          false,
        ],
        [
          "who is only in a hidden group",
          { hidden: [{ ...alice, hiddenGroups: [{ id: "group-1", name: "Family" }] }] },
          [device({ deviceId: "a1" })],
          false,
        ],
        [
          "whose one phone's location can't be read",
          { cantRead: [unreadable] },
          [device({ deviceId: "a1" })],
          false,
        ],
        [
          "who has two phones and whose location can't be read",
          { cantRead: [unreadable] },
          [device({ deviceId: "a1" }), device({ deviceId: "a2" })],
          true,
        ],
        [
          "who has two phones in a group whose key this phone lacks",
          { cantRead: [{ ...unreadable, reason: "groupKey" as const }] },
          [device({ deviceId: "a1" }), device({ deviceId: "a2" })],
          false,
        ],
        [
          "who is this account",
          { cantLocate: [{ ...alice, isSelf: true }] },
          [device({ deviceId: "a1" })],
          false,
        ],
      ])("someone %s can be asked: %p", async (_, people, devices, shown) => {
        const sheet = await openMissingSheet({ devices, people });
        expect(sheet.props["canRequestUpdate"]).toBe(shown);
      });

      test("asks for that person's location", async () => {
        const asked: string[] = [];
        const sheet = await openMissingSheet({
          devices: [device({ deviceId: "a1" }), device({ deviceId: "b1", userId: "bob" })],
          onRequestUpdate: async (userId) => {
            asked.push(userId);
          },
          people: { cantLocate: [alice] },
        });
        await act(async () =>
          (sheet.props["onRequestUpdate"] as (() => Promise<void>) | undefined)?.(),
        );
        expect(asked).toEqual(["alice"]);
      });
    });
  });

  describe("Android back button", () => {
    const people: MapPeople = {
      cantLocate: [],
      cantRead: [],
      finding: [],
      hidden: [],
      outOfDate: [],
      paused: [
        {
          groupNames: ["Family"],
          image: null,
          initials: "TO",
          isSelf: false,
          name: "Tom",
          sharingPaused: true,
          timelineGroupId: "family",
          userId: "tom",
        },
      ],
      upToDate: [],
      waiting: [],
      waitingForLocation: [],
    };
    const findAll = (type: string) =>
      root?.container.queryAll((instance) => instance.type === type) ?? [];
    const pressBack = async () => {
      const listeners = [...backPressListeners].reverse();
      let handled = false;
      await act(async () => {
        handled = listeners.some((listener) => listener());
      });
      return handled;
    };

    test("leaves back to the system when nothing is open", async () => {
      await renderNativeMap({ markers: [createLiveMapMarkerFixture({ userId: "alice" })] });
      expect(await pressBack()).toBe(false);
    });

    test("closes a person's card like a swipe, clearing the selection and speed chip", async () => {
      setSystemTime(new Date("2026-07-19T10:01:00.000Z"));
      const selections: Array<string | null> = [];
      await renderSelectableNativeMap(
        [createLiveMapMarkerFixture({ name: "Alice", speed: 13.4, userId: "alice" })],
        selections,
      );
      await act(async () => {
        emitNativeMapRegionDidChange({ latitude: 51.5, longitude: -0.12, zoomLevel: 14 });
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      await act(async () => emitNativeMapIosAnnotationTap("alice"));
      expect(findAll("live-map-person-sheet")).toHaveLength(1);
      expect(findAll("speed-chip")).toHaveLength(1);

      expect(await pressBack()).toBe(true);
      expect(selections).toEqual(["alice", null]);
      expect(findAll("live-map-person-sheet")).toHaveLength(0);
      expect(findAll("speed-chip")).toHaveLength(0);
      expect(await pressBack()).toBe(false);
      setSystemTime();
    });

    test("closes a place's card", async () => {
      const home = {
        canManage: false,
        emoji: "🏠",
        groupId: "family",
        groupName: "Family",
        id: "home",
        latitude: 51.5,
        longitude: -0.12,
        memberUserIds: [],
        name: "Home",
        radiusMeters: 250,
      };
      await renderNativeMap({ places: [home] });
      await renderNativeMap({ focusPlaceId: "home", places: [home] });
      await flushEffects();
      expect(findAll("live-map-place-sheet")).toHaveLength(1);

      expect(await pressBack()).toBe(true);
      expect(findAll("live-map-place-sheet")).toHaveLength(0);
      expect(await pressBack()).toBe(false);
    });

    test("closes a stack's list", async () => {
      testPlatform.OS = "android";
      await renderSelectableNativeMap(
        [
          createLiveMapMarkerFixture({ userId: "alice", name: "Alice" }),
          createLiveMapMarkerFixture({ userId: "bob", name: "Bob" }),
        ],
        [],
      );
      const [stackId] = getNativeMapMountedAnnotationIds();
      await act(async () => emitNativeMapAndroidMarkerTap(stackId ?? ""));
      expect(findAll("live-map-stack-sheet")).toHaveLength(1);

      expect(await pressBack()).toBe(true);
      expect(findAll("live-map-stack-sheet")).toHaveLength(0);
      expect(await pressBack()).toBe(false);
    });

    test("closes one layer per press: missing person's card, then the People card", async () => {
      const trayChanges: boolean[] = [];
      await renderNativeMap({
        onPeopleTrayOpenChange: (open) => {
          trayChanges.push(open);
        },
        people,
        peopleTrayOpen: true,
      });
      await act(async () =>
        (
          findAll("live-map-people-tray")[0]?.props["onSelectPerson"] as
            ((userId: string) => void) | undefined
        )?.("tom"),
      );
      expect(findAll("live-map-missing-person-sheet")).toHaveLength(1);

      expect(await pressBack()).toBe(true);
      expect(findAll("live-map-missing-person-sheet")).toHaveLength(0);
      expect(findAll("live-map-people-tray")).toHaveLength(1);
      expect(trayChanges).toEqual([]);

      expect(await pressBack()).toBe(true);
      expect(trayChanges).toEqual([false]);
    });

    test("closes the groups menu before the People card under it", async () => {
      const trayChanges: boolean[] = [];
      await renderNativeMap({
        groupOptions: [
          { color: "#FF1464", hidden: false, id: "family", memberCount: 3, name: "Family" },
          { color: "#2A9D8F", hidden: false, id: "club", memberCount: 4, name: "Club" },
        ],
        onPeopleTrayOpenChange: (open) => {
          trayChanges.push(open);
        },
        people,
        peopleTrayOpen: true,
      });
      const groupsButton = findAll("pressable").find((instance) =>
        String(instance.props["accessibilityLabel"]).startsWith("Groups on the map"),
      );
      await act(async () => (groupsButton?.props["onPress"] as (() => void) | undefined)?.());
      expect(findAll("live-map-group-menu")).toHaveLength(1);

      expect(await pressBack()).toBe(true);
      expect(findAll("live-map-group-menu")).toHaveLength(0);
      expect(trayChanges).toEqual([]);

      expect(await pressBack()).toBe(true);
      expect(trayChanges).toEqual([false]);
    });

    test("ignores back while another screen covers the map", async () => {
      screenFocused = false;
      await renderNativeMap({ people, peopleTrayOpen: true });
      expect(findAll("live-map-people-tray")).toHaveLength(1);
      expect(await pressBack()).toBe(false);
    });
  });
});
