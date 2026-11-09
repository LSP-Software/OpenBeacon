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
  emitRemovedAnnotationDeselected,
  emitNativeMapAnnotationDeselected,
  emitNativeMapAnnotationSelected,
  emitNativeMapDidFailLoadingMap,
  emitNativeMapLog,
  emitNativeMapDidFinishLoadingStyle,
  emitNativeMapGoToCurrentLocation,
  emitNativeMapPress,
  emitNativeMapRegionDidChange,
  emitNativeMapRegionIsChanging,
  emitNativeMapShowEveryone,
  getNativeMapAnnotationMountCount,
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
} from "./nativeMapTestHarness.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let currentSignedPmtilesUrlQuery: {
  data?: {
    archiveKey?: string;
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
let deferForceRefresh = false;
let completeForceRefresh: (() => void) | null = null;
let forceRefreshUrl = "https://forced.example/pmtiles";
const setQueryData = mock(() => {});
const routerReplace = mock(() => {});
let root: Root | null = null;
const testPlatform = { OS: "ios" as "ios" | "android" };
let mapAssetUrls: { glyphs: string; sprites: string } | null = null;

mock.module("react-native", () => {
  const reactNative = createReactNativeTestModule({ platformOS: "android" });
  return {
    ...reactNative,
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
  ArrowUpIcon: () => React.createElement("arrow-up-icon"),
  LocateFixedIcon: () => React.createElement("locate-fixed-icon"),
  MapPinIcon: () => React.createElement("map-pin-icon"),
  ScanIcon: () => React.createElement("scan-icon"),
}));

mock.module("../ui/Icon.tsx", () => ({
  Icon: () => React.createElement("icon"),
}));

mock.module("@tanstack/react-query", () => ({
  useMutation: (options: {
    onError?: (error: Error) => void;
    onSuccess?: (data: unknown) => void;
  }) => ({
    isPending: forceRefreshMutationPending,
    mutate: () => {
      forceRefreshMutationCalls += 1;
      if (!forceRefreshMutationSucceeds) {
        options.onError?.(new Error("force refresh failed"));
        return;
      }

      const resultUrl = forceRefreshUrl;
      const complete = () =>
        options.onSuccess?.({
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

mock.module("expo-file-system", () => ({
  Paths: { bundle: { uri: "file:///app" } },
}));

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
  getSymbolLayerIds: (style: { layers: { id: string; type: string }[] }) =>
    style.layers.filter((layer) => layer.type === "symbol").map((layer) => layer.id),
  getSymbolVisibility: (showSymbols: boolean) => (showSymbols ? "visible" : "none"),
}));

mock.module("../../lib/storage.ts", () => ({
  storage: { getBoolean: () => undefined, set: () => {} },
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

mock.module("./LiveMapStackSheet.tsx", () => ({
  LiveMapStackSheet: ({ members }: { members: readonly LiveMapMarker[] }) =>
    React.createElement("live-map-stack-sheet", { count: members.length }),
}));

mock.module("./LiveMapStackPin.tsx", () => ({
  LiveMapStackPin: ({ members }: { members: readonly LiveMapMarker[] }) =>
    React.createElement("live-map-stack-pin", { count: members.length }),
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
    testPlatform.OS = "ios";
    mapAssetUrls = null;
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
    deferForceRefresh = false;
    completeForceRefresh = null;
    forceRefreshUrl = "https://forced.example/pmtiles";
    setQueryData.mockReset();
    routerReplace.mockReset();
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
      ["roads_labels_major", { visibility: "visible" }],
      ["pois", { visibility: "visible" }],
    ]);

    await act(async () => {
      toggle()();
      await Promise.resolve();
    });

    expect(styleLayers()).toEqual([
      ["roads_labels_major", { visibility: "none" }],
      ["pois", { visibility: "none" }],
    ]);
    expect(mapStyleProp()).toBe(initialStyle);
    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapRemovedStyleLayerIds()).toEqual([]);
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
        platform === "ios"
          ? getNativeMapMountedAnnotationIds().filter((id) => id === "alice").length
          : (root?.container.queryAll((instance) => instance.type === "marker-view") ?? []).length;
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

  test("keeps the selection when a native annotation is replaced by an edge pin", async () => {
    const selections: Array<string | null> = [];
    const marker = createLiveMapMarkerFixture({ userId: "alice" });
    setNativeMapProjectedPoint([-10, 300]);
    await renderNativeMap({
      markers: [marker],
      selectedUserId: "alice",
      onSelectUserId: (id) => selections.push(id),
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
    expect(getRenderedOutput()).toContain("Go to Alice");
    await act(async () => {
      emitRemovedAnnotationDeselected("alice");
      await Promise.resolve();
    });
    expect(selections).toEqual([]);
  });

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
      markers: [createLiveMapMarkerFixture({ userId: "alice" })],
      selectedUserId: "alice",
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
        instance.type === "pressable" && instance.props["accessibilityLabel"] === "Go to Alice",
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
    const originalSetTimeout = globalThis.setTimeout;
    let retry: (() => void) | undefined;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      if (delay === 5_000) retry = callback as () => void;
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout;
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
      expect(getRenderedOutput()).toContain("activity-indicator");
      await finishLoadingStyle();
      expect(getRenderedOutput()).toContain("activity-indicator");
      expect(retry).toBeDefined();
      await act(async () => {
        retry?.();
      });
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getNativeMapViewMountCount()).toBe(2);
      await finishLoadingStyle();
      expect(getRenderedOutput()).not.toContain("activity-indicator");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("restores selected person padding when retrying the same archive", async () => {
    const alice = createLiveMapMarkerFixture({ userId: "alice", latitude: 51.5, longitude: -0.12 });
    forceRefreshUrl = "https://cached.example/pmtiles-1?signature=new";
    await renderNativeMap({ markers: [alice], selectedUserId: "alice" });
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
    const originalSetTimeout = globalThis.setTimeout;
    let retry: (() => void) | undefined;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      if (delay === 5_000) retry = callback as () => void;
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout;
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
      expect(retry).toBeDefined();
      await act(async () => {
        retry?.();
      });
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getNativeMapViewMountCount()).toBe(2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("keeps retrying a PMTiles source failure when the first credential refresh fails", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let retry: (() => void) | undefined;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      if (delay === 5_000) retry = callback as () => void;
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout;
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
        retry?.();
      });
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getNativeMapViewMountCount()).toBe(1);
      expect(getRenderedOutput()).toContain("activity-indicator");
      forceRefreshMutationSucceeds = true;
      await act(async () => {
        retry?.();
      });
      expect(forceRefreshMutationCalls).toBe(2);
      expect(getNativeMapViewMountCount()).toBe(2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
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
    expect(getRenderedOutput()).toContain("activity-indicator");
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

  test("automatically retries a failed refresh while showing a loading indicator", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let retry: (() => void) | undefined;
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      if (delay === 5_000) retry = callback as () => void;
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout;

    try {
      forceRefreshMutationSucceeds = false;
      await renderNativeMap();
      await failMapLoad();
      expect(forceRefreshMutationCalls).toBe(1);
      expect(getRenderedOutput()).toContain("activity-indicator");
      expect(retry).toBeDefined();

      forceRefreshMutationSucceeds = true;
      await act(async () => {
        retry?.();
      });
      expect(forceRefreshMutationCalls).toBe(2);
      expect(setQueryData).toHaveBeenCalled();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
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
        url: "https://cached.example/pmtiles-2",
      },
    };

    await renderNativeMap({ markers: [alice, bob] });
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapCameraDefaultSettings()).toEqual({
      centerCoordinate: [-0.13, 51.51],
      zoomLevel: 12.5,
    });
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
      selectedUserId: "alice",
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
      selectedUserId: "alice",
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

  test("preserves programmatic fit camera across remount without region events", async () => {
    const alice = createLiveMapMarkerFixture({
      latitude: 51.5,
      longitude: -0.12,
      userId: "alice",
    });

    await renderNativeMap({ markers: [alice] });
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

  test("repeated map-load failures show recoverable UI instead of looping", async () => {
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
    expect(getRenderedOutput()).toContain("activity-indicator");

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
      selectedUserId: "alice",
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
      selectedUserId: "alice",
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

  test("releases MapLibre's retained focus target before native marker updates can replay it", async () => {
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
    setNativeMapSelfHeadingDegrees(90);
    await renderNativeMap({
      markers: [alice],
      selectedUserId: "alice",
    });
    await flushEffects();

    expect(getNativeMapCameraCommands()).toHaveLength(commandsAfterRelease);
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
      onSelectUserId: (userId) => {
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
            animationDuration: 500,
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
      onSelectUserId: (userId) => {
        selections.push(userId);
      },
      selectedUserId: "self",
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

    expect(root?.container.queryAll((instance) => instance.type === "marker-view")).toHaveLength(1);
    const stack = root?.container.queryAll(
      (instance) =>
        instance.type === "pressable" &&
        instance.props["accessibilityLabel"] === "2 people: Alice, Bob",
    )[0];
    await act(async () =>
      (stack?.props["onPress"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { pageX: 100, pageY: 200 },
      }),
    );
    await act(async () => emitNativeMapPress([100, 200]));

    expect(
      root?.container.queryAll((instance) => instance.type === "live-map-stack-sheet")[0]?.props,
    ).toMatchObject({ count: 2 });
    expect(selectionHistory).toEqual([null]);
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
    const stack = root?.container.queryAll(
      (instance) =>
        instance.type === "pressable" &&
        String(instance.props["accessibilityLabel"]).startsWith("2 people"),
    )[0];
    await act(async () =>
      (stack?.props["onPress"] as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { pageX: 100, pageY: 200 },
      }),
    );
    expect(stackSheets()).toHaveLength(1);

    await act(async () => emitNativeMapGoToCurrentLocation());
    await flushEffects();
    expect(stackSheets()).toHaveLength(0);

    await act(async () => emitNativeMapPress([300, 400]));
    await flushEffects();
    expect(stackSheets()).toHaveLength(0);
  });

  test("Android marker views render and select without bitmap annotations", async () => {
    testPlatform.OS = "android";
    const alice = createLiveMapMarkerFixture({ userId: "alice" });
    const bob = createLiveMapMarkerFixture({
      latitude: 40,
      longitude: 20,
      userId: "bob",
      name: "Bob",
    });
    const selectionHistory: Array<string | null> = [];
    await renderSelectableNativeMap([alice, bob], selectionHistory);

    const pressMarker = async (name: string) => {
      const marker = root?.container.queryAll(
        (instance) =>
          instance.type === "pressable" && instance.props["accessibilityLabel"] === name,
      )[0];
      if (!marker) throw new Error(`Missing marker ${name}`);
      await act(async () =>
        (marker.props as { onPress: (event: unknown) => void }).onPress({
          nativeEvent: { pageX: 100, pageY: 200 },
        }),
      );
    };

    expect(root?.container.queryAll((instance) => instance.type === "marker-view")).toHaveLength(2);
    expect(getNativeMapMountedAnnotationIds()).toEqual([]);
    await pressMarker("Alice");
    await pressMarker("Alice");
    await pressMarker("Bob");
    await act(async () => emitNativeMapPress([100, 200]));
    expect(selectionHistory).toEqual(["alice", null, "bob"]);

    await act(async () => emitNativeMapPress([300, 400]));
    await pressMarker("Alice");
    expect(selectionHistory).toEqual(["alice", null, "bob", null, "alice"]);
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
      latitude: 40,
      longitude: 20,
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
    const oldUrl = "https://tiles.example.com/planet-old.pmtiles";
    const newUrl = "https://tiles.example.com/planet-new.pmtiles";
    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, archiveKey: "planet-old.pmtiles", url: `${oldUrl}?sig=1` },
    };
    await renderNativeMap();
    await flushEffects();

    currentSignedPmtilesUrlQuery = {
      ...currentSignedPmtilesUrlQuery,
      data: { ...defaultSignedUrl, archiveKey: "planet-new.pmtiles", url: `${newUrl}?sig=2` },
    };
    await renderNativeMap();
    await flushEffects();

    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapUrlTransformEvents()).toEqual([
      `add:openbeacon-pmtiles:${oldUrl}`,
      `add:openbeacon-pmtiles:${newUrl}`,
      `remove:openbeacon-pmtiles:${oldUrl}:liveMaps=0`,
    ]);
  });

  test("updates the map style without remounting when the signed pmtiles url changes", async () => {
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
    await finishLoadingStyle();

    expect(getNativeMapViewMountCount()).toBe(1);
    expect(getNativeMapStyle()).toMatchObject({
      pmtilesUrl: "https://cached.example/pmtiles-2",
      version: 8,
    });
    expect(getNativeMapCameraDefaultSettings()).toEqual({
      centerCoordinate: [-0.12, 51.5],
      zoomLevel: 14,
    });
    expect(
      getNativeMapCameraCommands().some(
        (command) =>
          command.type === "setCamera" &&
          typeof command.stop === "object" &&
          command.stop !== null &&
          "centerCoordinate" in command.stop &&
          (command.stop as { centerCoordinate: [number, number] }).centerCoordinate[0] === -0.12 &&
          (command.stop as { zoomLevel?: number }).zoomLevel === 14,
      ),
    ).toBe(true);
  });
});
