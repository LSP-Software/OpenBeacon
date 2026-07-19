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
  getNativeMapAnnotationRefreshCalls,
  getNativeMapCameraCommands,
  getNativeMapCameraDefaultSettings,
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
  LiveMapMarkerPin: () => React.createElement("live-map-marker-pin"),
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
          (command.stop as { zoomLevel?: number }).zoomLevel === 15,
      ),
    ).toBe(true);
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
