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
  getNativeMapStyle,
  getNativeMapViewMountCount,
  registerNativeMapGoToCurrentLocationHandler,
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
      if (props.accessibilityLabel === "Go to current location") {
        registerNativeMapGoToCurrentLocationHandler(props.onPress ?? null);
      }
      return reactNative.Pressable(props);
    },
  };
});

mock.module("lucide-react-native", () => ({
  LocateFixedIcon: () => React.createElement("locate-fixed-icon"),
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

const pressRetryButton = async () => {
  if (!root) {
    throw new Error("Missing root");
  }

  const button = root.container.queryAll((instance) => instance.type === "button")[0];
  if (!button) {
    throw new Error("Missing retry button");
  }

  const props = button.props as {
    onClick?: () => void;
  };

  await act(async () => {
    props.onClick?.();
    await Promise.resolve();
  });
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
    expect(getRenderedOutput()).toContain("The map could not be loaded.");
  });

  test("does not force refresh while a force-refresh mutation is already pending", async () => {
    forceRefreshMutationPending = true;
    await renderNativeMap();

    await failMapLoad();

    expect(forceRefreshMutationCalls).toBe(0);
  });

  test("resets retry eligibility and shows recoverable UI when force refresh fails", async () => {
    forceRefreshMutationSucceeds = false;
    await renderNativeMap();

    await failMapLoad();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(setQueryData).not.toHaveBeenCalled();
    expect(getRenderedOutput()).toContain("The map could not be loaded.");

    await failMapLoad();
    expect(forceRefreshMutationCalls).toBe(1);

    forceRefreshMutationSucceeds = true;
    await pressRetryButton();

    expect(forceRefreshMutationCalls).toBe(2);
    expect(setQueryData).toHaveBeenCalledWith(
      [["maps", "getSignedPmtilesUrl"]],
      expect.objectContaining({
        url: "https://forced.example/pmtiles",
      }),
    );
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

    expect(getNativeMapViewMountCount()).toBe(2);
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

  test("ignores manual retry while a force refresh is already pending", async () => {
    forceRefreshMutationSucceeds = false;
    await renderNativeMap();

    await failMapLoad();
    expect(forceRefreshMutationCalls).toBe(1);
    expect(getRenderedOutput()).toContain("The map could not be loaded.");

    forceRefreshMutationPending = true;
    forceRefreshMutationSucceeds = true;
    await renderNativeMap();
    await pressRetryButton();
    await pressRetryButton();

    expect(forceRefreshMutationCalls).toBe(1);
    expect(getRenderedOutput()).toContain("The map could not be loaded.");
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
    expect(getRenderedOutput()).toContain("The map could not be loaded.");

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
      type: "setCamera",
      stop: {
        animationDuration: 0,
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
      type: "setCamera",
      stop: {
        animationDuration: 0,
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

    expect(getNativeMapViewMountCount()).toBe(2);
    expect(getNativeMapStyle()).toEqual({
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
