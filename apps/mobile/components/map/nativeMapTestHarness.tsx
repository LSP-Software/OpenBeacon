import React, { forwardRef, type ReactNode, useEffect, useImperativeHandle } from "react";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";

const cameraCommands: Array<
  | {
      type: "setCamera";
      stop: unknown;
    }
  | {
      type: "fitBounds";
      ne: unknown;
      sw: unknown;
      padding: unknown;
      duration: unknown;
    }
> = [];
const annotationRefreshCalls: string[] = [];
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
let mapViewHandlers: {
  onDidFailLoadingMap?: () => void;
  onDidFinishLoadingStyle?: () => void;
  onPress?: () => void;
  onRegionDidChange?: (feature: {
    properties: {
      isUserInteraction: boolean;
    };
  }) => void;
} = {};
let mapViewMountCount = 0;
let latestMapStyle: unknown = null;
let selfHeadingDegrees: number | null = null;
let showEveryonePressHandler: (() => void) | null = null;
let androidActiveAnnotationId: string | null = null;

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
  annotationRefreshCalls.length = 0;
  annotationMountCounts.clear();
  annotationSelectedProps.clear();
  annotationHandlersById.clear();
  mountedAnnotationIds.clear();
  mapViewHandlers = {};
  mapViewMountCount = 0;
  latestMapStyle = null;
  selfHeadingDegrees = null;
  showEveryonePressHandler = null;
  androidActiveAnnotationId = null;
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

export const emitNativeMapRegionDidChange = (isUserInteraction: boolean) => {
  mapViewHandlers.onRegionDidChange?.({
    properties: {
      isUserInteraction,
    },
  });
};

export const emitNativeMapShowEveryone = () => {
  showEveryonePressHandler?.();
};

export const emitNativeMapAnnotationSelected = (annotationId: string) => {
  annotationHandlersById.get(annotationId)?.onSelected?.();
};

export const emitNativeMapAnnotationDeselected = (annotationId: string) => {
  annotationHandlersById.get(annotationId)?.onDeselected?.();
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
  const Camera = forwardRef<
    {
      fitBounds: (ne: unknown, sw: unknown, padding: unknown, duration: unknown) => void;
      setCamera: (stop: unknown) => void;
    },
    Record<string, unknown>
  >((_props, ref) => {
    useImperativeHandle(ref, () => ({
      fitBounds: (ne: unknown, sw: unknown, padding: unknown, duration: unknown) => {
        cameraCommands.push({ type: "fitBounds", ne, sw, padding, duration });
      },
      setCamera: (stop: unknown) => {
        cameraCommands.push({ type: "setCamera", stop });
      },
    }));

    return React.createElement("camera");
  });
  Camera.displayName = "MockMapLibreCamera";

  const MapView = ({
    children,
    mapStyle,
    onDidFailLoadingMap,
    onDidFinishLoadingStyle,
    onPress,
    onRegionDidChange,
  }: {
    children?: ReactNode;
    mapStyle?: unknown;
    onDidFailLoadingMap?: () => void;
    onDidFinishLoadingStyle?: () => void;
    onPress?: () => void;
    onRegionDidChange?: (feature: {
      properties: {
        isUserInteraction: boolean;
      };
    }) => void;
  }) => {
    mapViewHandlers = {
      ...(onDidFailLoadingMap ? { onDidFailLoadingMap } : {}),
      ...(onDidFinishLoadingStyle ? { onDidFinishLoadingStyle } : {}),
      ...(onPress ? { onPress } : {}),
      ...(onRegionDidChange ? { onRegionDidChange } : {}),
    };
    latestMapStyle = mapStyle ?? null;

    useEffect(() => {
      mapViewMountCount += 1;
    }, []);

    return React.createElement(
      "map-view",
      {
        mapStyle,
        onDidFailLoadingMap,
        onDidFinishLoadingStyle,
        onPress,
        onRegionDidChange,
      },
      children,
    );
  };

  const PointAnnotation = forwardRef<
    { refresh: () => void },
    {
      children?: ReactNode;
      id: string;
      onDeselected?: () => void;
      onSelected?: () => void;
      selected?: boolean;
    }
  >(({ children, id, onDeselected, onSelected, selected }, ref) => {
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
    MapView,
    PointAnnotation,
  };
};

export const registerNativeMapShowEveryoneHandler = (onPress: (() => void) | null) => {
  showEveryonePressHandler = onPress;
};
