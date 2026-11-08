import type { CameraRef } from "@maplibre/maplibre-react-native";
import React, { forwardRef, type ReactNode, useEffect, useImperativeHandle } from "react";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";

const cameraCommands: Array<
  | {
      type: "setCamera";
      stop: unknown;
    }
  | { type: "setStop"; stop: Parameters<CameraRef["setStop"]>[0] }
  | {
      type: "fitBounds";
      ne: unknown;
      sw: unknown;
      padding: unknown;
      duration: unknown;
    }
> = [];
let mapLogHandler:
  | ((log: {
      level: "error" | "warn" | "info" | "debug" | "verbose";
      tag: string;
      message: string;
    }) => boolean)
  | null = null;
export const emitNativeMapLog = (log: {
  level: "error" | "warn" | "info" | "debug" | "verbose";
  tag: string;
  message: string;
}) => mapLogHandler?.(log) ?? false;
const annotationRefreshCalls: string[] = [];
const urlTransforms: Array<{ id: string; find: string; replace: string }> = [];
export const getNativeMapUrlTransforms = () => urlTransforms;
const urlTransformEvents: string[] = [];
export const getNativeMapUrlTransformEvents = () => urlTransformEvents;
const annotationMountCounts = new Map<string, number>();
const annotationSelectedProps = new Map<string, boolean | undefined>();
const annotationHandlersById = new Map<
  string,
  {
    onDeselected?: () => void;
    onSelected?: () => void;
  }
>();
const mountedAnnotationIds = new Set<string>();
const removedAnnotationDeselectionHandlers = new Map<string, () => void>();
let mapViewHandlers: {
  onDidFailLoadingMap?: () => void;
  onDidFinishLoadingStyle?: () => void;
  onPress?: () => void;
  onRegionDidChange?: (feature: {
    geometry: { coordinates: [number, number] };
    properties: {
      animated: boolean;
      isUserInteraction: boolean;
      zoomLevel: number;
      visibleBounds?: [[number, number], [number, number]];
    };
  }) => void;
  onRegionIsChanging?: (feature: {
    geometry: { coordinates: [number, number] };
    properties: {
      animated: boolean;
      isUserInteraction: boolean;
      zoomLevel: number;
      visibleBounds?: [[number, number], [number, number]];
    };
  }) => void;
} = {};
let mapViewMountCount = 0;
let liveMapViewCount = 0;
let latestMapStyle: unknown = null;
let latestCameraDefaultSettings: {
  centerCoordinate?: [number, number];
  zoomLevel?: number;
} | null = null;
let selfHeadingDegrees: number | null = null;
let showEveryonePressHandler: (() => void) | null = null;
let goToCurrentLocationPressHandler: (() => void) | null = null;
let androidActiveAnnotationId: string | null = null;
let mapProjectedPoint: [number, number] = [200, 300];
let mapProjectionWait: Promise<void> | null = null;
const removedStyleLayerIds: string[] = [];

export const createLiveMapMarkerFixture = (
  overrides: Partial<LiveMapMarker> & Pick<LiveMapMarker, "userId">,
): LiveMapMarker => ({
  battery: { charging: false, level: 0.8 },
  image: null,
  initials: "AL",
  isSelf: false,
  latitude: 51.5,
  longitude: -0.12,
  name: "Alice",
  otherSharedGroupNames: [],
  ringColor: "#3366FF",
  sourceGroupId: "group-1",
  timestamp: "2026-07-19T10:00:00.000Z",
  ...overrides,
});

export const resetNativeMapHarness = () => {
  cameraCommands.length = 0;
  mapLogHandler = null;
  urlTransforms.length = 0;
  urlTransformEvents.length = 0;
  annotationRefreshCalls.length = 0;
  annotationMountCounts.clear();
  annotationSelectedProps.clear();
  annotationHandlersById.clear();
  mountedAnnotationIds.clear();
  removedAnnotationDeselectionHandlers.clear();
  mapViewHandlers = {};
  mapViewMountCount = 0;
  liveMapViewCount = 0;
  latestMapStyle = null;
  latestCameraDefaultSettings = null;
  selfHeadingDegrees = null;
  showEveryonePressHandler = null;
  goToCurrentLocationPressHandler = null;
  androidActiveAnnotationId = null;
  mapProjectedPoint = [200, 300];
  mapProjectionWait = null;
  removedStyleLayerIds.length = 0;
};

export const setNativeMapProjectedPoint = (point: [number, number]) => {
  mapProjectedPoint = point;
};

export const setNativeMapProjectionWait = (wait: Promise<void> | null) => {
  mapProjectionWait = wait;
};

export const getNativeMapCameraCommands = () => [...cameraCommands];

export const getNativeMapAnnotationRefreshCalls = () => [...annotationRefreshCalls];

export const getNativeMapAnnotationMountCount = (annotationId: string) =>
  annotationMountCounts.get(annotationId) ?? 0;

export const getNativeMapAnnotationSelectedProp = (annotationId: string) =>
  annotationSelectedProps.get(annotationId);

export const getNativeMapMountedAnnotationIds = () => [...mountedAnnotationIds];

export const getNativeMapViewMountCount = () => mapViewMountCount;

export const getNativeMapStyle = () => latestMapStyle;

export const getNativeMapRemovedStyleLayerIds = () => [...removedStyleLayerIds];

export const getNativeMapCameraDefaultSettings = () => latestCameraDefaultSettings;

export const setNativeMapSelfHeadingDegrees = (headingDegrees: number | null) => {
  selfHeadingDegrees = headingDegrees;
};

export const getNativeMapSelfHeadingDegrees = () => selfHeadingDegrees;

export const emitNativeMapPress = () => {
  mapViewHandlers.onPress?.();
};

export const emitNativeMapDidFailLoadingMap = () => {
  mapViewHandlers.onDidFailLoadingMap?.();
};

export const emitNativeMapDidFinishLoadingStyle = () => {
  mapViewHandlers.onDidFinishLoadingStyle?.();
};

export const emitNativeMapRegionDidChange = (
  input:
    | boolean
    | {
        animated?: boolean;
        latitude: number;
        longitude: number;
        zoomLevel: number;
        isUserInteraction?: boolean;
      },
) => {
  if (typeof input === "boolean") {
    mapViewHandlers.onRegionDidChange?.({
      geometry: {
        coordinates: [0, 0],
      },
      properties: {
        animated: true,
        isUserInteraction: input,
        zoomLevel: 1,
      },
    });
    return;
  }

  mapViewHandlers.onRegionDidChange?.({
    geometry: {
      coordinates: [input.longitude, input.latitude],
    },
    properties: {
      animated: input.animated ?? true,
      isUserInteraction: input.isUserInteraction ?? true,
      zoomLevel: input.zoomLevel,
    },
  });
};

export const emitNativeMapRegionIsChanging = ({
  animated = false,
  isUserInteraction = true,
  latitude,
  longitude,
  zoomLevel,
  visibleBounds,
}: {
  animated?: boolean;
  isUserInteraction?: boolean;
  latitude: number;
  longitude: number;
  zoomLevel: number;
  visibleBounds?: [[number, number], [number, number]];
}) => {
  mapViewHandlers.onRegionIsChanging?.({
    geometry: {
      coordinates: [longitude, latitude],
    },
    properties: {
      animated,
      isUserInteraction,
      zoomLevel,
      ...(visibleBounds ? { visibleBounds } : {}),
    },
  });
};

export const emitNativeMapShowEveryone = () => {
  showEveryonePressHandler?.();
};

export const emitNativeMapGoToCurrentLocation = () => {
  goToCurrentLocationPressHandler?.();
};

export const emitNativeMapAnnotationSelected = (annotationId: string) => {
  annotationHandlersById.get(annotationId)?.onSelected?.();
};

export const emitNativeMapAnnotationDeselected = (annotationId: string) => {
  annotationHandlersById.get(annotationId)?.onDeselected?.();
};

export const emitRemovedAnnotationDeselected = (annotationId: string) => {
  removedAnnotationDeselectionHandlers.get(annotationId)?.();
};

export const emitNativeMapAndroidMarkerTap = (annotationId: string) => {
  const previouslyActiveId = androidActiveAnnotationId;

  if (previouslyActiveId !== null) {
    androidActiveAnnotationId = null;
    emitNativeMapAnnotationDeselected(previouslyActiveId);
  }

  if (previouslyActiveId !== annotationId) {
    androidActiveAnnotationId = annotationId;
    emitNativeMapAnnotationSelected(annotationId);
  }
};

export const createMapLibreMockModule = () => {
  const recordStop = (
    stop: { center: unknown; zoom?: number; padding?: unknown; duration?: number },
    mode?: string,
  ) => {
    const pad = stop.padding as
      { top: number; right: number; bottom: number; left: number } | undefined;
    cameraCommands.push({
      type: "setCamera",
      stop: {
        animationDuration: stop.duration ?? 0,
        ...(mode ? { animationMode: mode } : {}),
        centerCoordinate: stop.center,
        ...(stop.zoom !== undefined ? { zoomLevel: stop.zoom } : {}),
        ...(pad
          ? {
              padding: {
                paddingTop: pad.top,
                paddingRight: pad.right,
                paddingBottom: pad.bottom,
                paddingLeft: pad.left,
              },
            }
          : {}),
      },
    });
  };
  const Camera = forwardRef<
    Pick<CameraRef, "fitBounds" | "setStop" | "jumpTo" | "easeTo" | "flyTo">,
    {
      initialViewState?: {
        center?: [number, number];
        zoom?: number;
        padding?: { top?: number; right?: number; bottom?: number; left?: number };
      };
    }
  >(({ initialViewState }, ref) => {
    const defaultSettings = initialViewState
      ? { centerCoordinate: initialViewState.center, zoomLevel: initialViewState.zoom }
      : undefined;
    latestCameraDefaultSettings = defaultSettings
      ? {
          ...(defaultSettings.centerCoordinate
            ? { centerCoordinate: defaultSettings.centerCoordinate }
            : {}),
          ...(defaultSettings.zoomLevel !== undefined
            ? { zoomLevel: defaultSettings.zoomLevel }
            : {}),
        }
      : null;

    useImperativeHandle(ref, () => ({
      fitBounds: (bounds, options) => {
        cameraCommands.push({
          type: "fitBounds",
          ne: [bounds[2], bounds[3]],
          sw: [bounds[0], bounds[1]],
          padding: options?.padding
            ? [
                options.padding.top,
                options.padding.right,
                options.padding.bottom,
                options.padding.left,
              ]
            : undefined,
          duration: options?.duration,
        });
      },
      setStop: async (stop) => {
        cameraCommands.push({ type: "setStop", stop });
      },
      jumpTo: (stop: { center: unknown; zoom?: number; padding?: unknown; duration?: number }) =>
        recordStop(stop),
      easeTo: (stop: { center: unknown; zoom?: number; padding?: unknown; duration?: number }) =>
        recordStop(stop, "easeTo"),
      flyTo: (stop: { center: unknown; zoom?: number; padding?: unknown; duration?: number }) =>
        recordStop(stop, "flyTo"),
    }));

    return React.createElement("camera", { initialViewState });
  });
  Camera.displayName = "MockMapLibreCamera";

  const MapView = forwardRef<
    { project: () => Promise<[number, number]> },
    {
      children?: ReactNode;
      mapStyle?: unknown;
      onDidFailLoadingMap?: () => void;
      onDidFinishLoadingMap?: () => void;
      onDidFinishLoadingStyle?: () => void;
      onPress?: () => void;
      onRegionDidChange?: (event: {
        nativeEvent: {
          center: [number, number];
          zoom: number;
          bounds: [number, number, number, number];
          animated: boolean;
          userInteraction: boolean;
        };
      }) => void;
      onRegionIsChanging?: (event: {
        nativeEvent: {
          center: [number, number];
          zoom: number;
          bounds: [number, number, number, number];
          animated: boolean;
          userInteraction: boolean;
        };
      }) => void;
    }
  >(
    (
      {
        children,
        mapStyle,
        onDidFailLoadingMap,
        onDidFinishLoadingMap,
        onDidFinishLoadingStyle,
        onPress,
        onRegionDidChange,
        onRegionIsChanging,
      },
      ref,
    ) => {
      useImperativeHandle(ref, () => ({
        project: async () => {
          const point = mapProjectedPoint;
          await mapProjectionWait;
          return point;
        },
      }));
      mapViewHandlers = {
        ...(onDidFailLoadingMap ? { onDidFailLoadingMap } : {}),
        ...(onDidFinishLoadingStyle ? { onDidFinishLoadingStyle } : {}),
        ...(onPress ? { onPress } : {}),
        ...(onRegionDidChange
          ? {
              onRegionDidChange: (feature) => {
                const b = feature.properties.visibleBounds;
                onRegionDidChange({
                  nativeEvent: {
                    center: feature.geometry.coordinates,
                    zoom: feature.properties.zoomLevel,
                    animated: feature.properties.animated,
                    userInteraction: feature.properties.isUserInteraction,
                    bounds: b ? [b[1][0], b[1][1], b[0][0], b[0][1]] : [0, 0, 0, 0],
                  },
                });
              },
            }
          : {}),
        ...(onRegionIsChanging
          ? {
              onRegionIsChanging: (feature) => {
                const b = feature.properties.visibleBounds;
                onRegionIsChanging({
                  nativeEvent: {
                    center: feature.geometry.coordinates,
                    zoom: feature.properties.zoomLevel,
                    animated: feature.properties.animated,
                    userInteraction: feature.properties.isUserInteraction,
                    bounds: b ? [b[1][0], b[1][1], b[0][0], b[0][1]] : [0, 0, 0, 0],
                  },
                });
              },
            }
          : {}),
      };
      latestMapStyle = typeof mapStyle === "string" ? JSON.parse(mapStyle) : (mapStyle ?? null);

      useEffect(() => {
        mapViewMountCount += 1;
        liveMapViewCount += 1;
        onDidFinishLoadingMap?.();
        return () => {
          liveMapViewCount -= 1;
        };
      }, []);

      return React.createElement(
        "map-view",
        {
          mapStyle,
          onDidFailLoadingMap,
          onDidFinishLoadingStyle,
          onPress,
          onRegionDidChange,
          onRegionIsChanging,
        },
        children,
      );
    },
  );
  MapView.displayName = "MockMapLibreMapView";

  const PointAnnotation = forwardRef<
    { refresh: () => void },
    {
      children?: ReactNode;
      id: string;
      onDeselect?: () => void;
      onSelect?: () => void;
      selected?: boolean;
    }
  >(({ children, id, onDeselect: onDeselected, onSelect: onSelected, selected }, ref) => {
    useImperativeHandle(ref, () => ({
      refresh: () => {
        annotationRefreshCalls.push(id);
      },
    }));

    annotationSelectedProps.set(id, selected);

    useEffect(() => {
      mountedAnnotationIds.add(id);
      annotationMountCounts.set(id, (annotationMountCounts.get(id) ?? 0) + 1);

      return () => {
        mountedAnnotationIds.delete(id);
        if (androidActiveAnnotationId === id) {
          androidActiveAnnotationId = null;
        }
      };
    }, [id]);

    useEffect(() => {
      annotationHandlersById.set(id, {
        ...(onDeselected ? { onDeselected } : {}),
        ...(onSelected ? { onSelected } : {}),
      });

      return () => {
        if (onDeselected) removedAnnotationDeselectionHandlers.set(id, onDeselected);
        annotationHandlersById.delete(id);
      };
    }, [id, onDeselected, onSelected]);

    return React.createElement(
      "point-annotation",
      {
        id,
        selected: selected ?? false,
      },
      children,
    );
  });
  PointAnnotation.displayName = "MockMapLibrePointAnnotation";

  return {
    Camera,
    Map: MapView,
    LogManager: {
      onLog: (callback: NonNullable<typeof mapLogHandler>) => {
        mapLogHandler = callback;
      },
    },
    TransformRequestManager: {
      addUrlTransform: (transform: { id: string; find: string; replace: string }) => {
        urlTransforms.push(transform);
        urlTransformEvents.push(`add:${transform.id}`);
        return transform.id;
      },
      removeUrlTransform: (id: string) => {
        urlTransformEvents.push(`remove:${id}:liveMaps=${liveMapViewCount}`);
      },
    },
    Marker: ({ children, lngLat }: { children?: ReactNode; lngLat: number[] }) =>
      React.createElement("marker-view", { coordinate: lngLat, allowOverlap: true }, children),
    ViewAnnotation: PointAnnotation,
    Layer: ({ id, layout }: { id: string; layout?: unknown }) => {
      useEffect(
        () => () => {
          removedStyleLayerIds.push(id);
        },
        [id],
      );
      return React.createElement("style-layer", { id, layout });
    },
  };
};

export const registerNativeMapShowEveryoneHandler = (onPress: (() => void) | null) => {
  showEveryonePressHandler = onPress;
};

export const registerNativeMapGoToCurrentLocationHandler = (onPress: (() => void) | null) => {
  goToCurrentLocationPressHandler = onPress;
};
