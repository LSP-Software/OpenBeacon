import {
  Camera,
  type CameraRef,
  MapView,
  PointAnnotation,
  type PointAnnotationRef,
} from "@maplibre/maplibre-react-native";
import { useMutation } from "@tanstack/react-query";
import { router, useRootNavigationState } from "expo-router";
import { ScanIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../../components/ui/Text.tsx";
import { useSelfDeviceHeading } from "../../hooks/useSelfDeviceHeading.ts";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { queryClient, trpc } from "../../lib/api.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { fitLiveMapMarkers } from "../../lib/fitLiveMapMarkers.ts";
import {
  createLiveMapInitialFitState,
  LIVE_MAP_INITIAL_FIT_COALESCE_MS,
  reduceLiveMapInitialFit,
} from "../../lib/liveMapInitialFit.ts";
import { buildLiveMapTrackingCameraStop } from "../../lib/liveMapTrackingCamera.ts";
import { shouldForceRefreshAfterMapLoadFailure } from "../../lib/mapPmtilesLoadFailure.ts";
import { getProtomapsMapStyle } from "../../lib/protomaps-style.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { Icon } from "../ui/Icon.tsx";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";
import { LiveMapPersonSheet } from "./LiveMapPersonSheet.tsx";

export const NativeMap = ({
  markers = [],
  onSelectUserId,
  selectedUserId = null,
}: {
  markers?: readonly LiveMapMarker[];
  onSelectUserId?: (userId: string | null) => void;
  selectedUserId?: string | null;
} = {}) => {
  const { mapTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const signedPmtilesUrlQuery = useSignedPmtilesUrl();
  const forceRefreshSignedPmtilesUrlMutation = useMutation({
    ...trpc.maps.forceRefreshSignedPmtilesUrl.mutationOptions(),
    onSuccess: (signedPmtilesUrl) => {
      queryClient.setQueryData(trpc.maps.getSignedPmtilesUrl.queryKey(), signedPmtilesUrl);
    },
  });
  const rootNavigationState = useRootNavigationState();
  const cameraRef = useRef<CameraRef>(null);
  const initialFitStateRef = useRef(createLiveMapInitialFitState());
  const initialFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRetryAfterMapFailureRef = useRef(false);
  const lastPmtilesUrlRef = useRef<string | null>(null);
  const trackedUserIdRef = useRef<string | null>(null);
  const trackedCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const followSuspendedRef = useRef(false);
  const suppressUserCameraControlUntilMsRef = useRef(0);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const selectedUserIdRef = useRef(selectedUserId);
  selectedUserIdRef.current = selectedUserId;
  const pendingDeselectClearRef = useRef(false);
  const [annotationRemountTokens, setAnnotationRemountTokens] = useState<Record<string, number>>(
    {},
  );
  const pmtilesUrl = signedPmtilesUrlQuery.data?.url ?? null;
  const selectedMarker = markers.find((marker) => marker.userId === selectedUserId) ?? null;
  const hasMarkers = markers.length > 0;
  const selectedLatitude = selectedMarker?.latitude;
  const selectedLongitude = selectedMarker?.longitude;
  const cameraPadding = useMemo(
    () => ({
      paddingBottom: selectedUserId ? 220 : 48,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: insets.top + 56,
    }),
    [insets.top, selectedUserId],
  );
  const fitEveryonePadding = useMemo(
    () => ({
      paddingBottom: 48,
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: insets.top + 56,
    }),
    [insets.top],
  );

  if (lastPmtilesUrlRef.current !== pmtilesUrl) {
    lastPmtilesUrlRef.current = pmtilesUrl;
    didRetryAfterMapFailureRef.current = false;
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "reset",
    }).state;
    trackedUserIdRef.current = null;
    trackedCoordinateRef.current = null;
    followSuspendedRef.current = false;
  }

  const mapStyle = useMemo(() => {
    if (!pmtilesUrl) {
      return null;
    }

    return getProtomapsMapStyle(mapTheme, pmtilesUrl);
  }, [mapTheme, pmtilesUrl]);

  const clearSelectionFromReact = () => {
    pendingDeselectClearRef.current = false;
    const previouslySelectedUserId = selectedUserIdRef.current;
    if (previouslySelectedUserId !== null) {
      setAnnotationRemountTokens((tokens) => ({
        ...tokens,
        [previouslySelectedUserId]: (tokens[previouslySelectedUserId] ?? 0) + 1,
      }));
    }
    onSelectUserId?.(null);
  };
  const handleAnnotationDeselected = () => {
    pendingDeselectClearRef.current = true;
    queueMicrotask(() => {
      if (!pendingDeselectClearRef.current) {
        return;
      }
      pendingDeselectClearRef.current = false;
      onSelectUserId?.(null);
    });
  };
  const handleAnnotationSelected = (userId: string) => {
    pendingDeselectClearRef.current = false;
    onSelectUserId?.(userId);
  };
  const fitEveryoneInFrame = () => {
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "show_everyone",
    }).state;
    trackedUserIdRef.current = null;
    trackedCoordinateRef.current = null;
    followSuspendedRef.current = false;
    clearSelectionFromReact();
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
    fitLiveMapMarkers({
      camera: cameraRef.current,
      markers: markersRef.current,
      padding: fitEveryonePadding,
    });
  };

  const noteUserCameraControl = () => {
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    followSuspendedRef.current = true;
  };

  useEffect(() => {
    return () => {
      clearLiveMapInitialFitTimer(initialFitTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!rootNavigationState?.key || signedPmtilesUrlQuery.error?.data?.code !== "UNAUTHORIZED") {
      return;
    }

    router.replace("/");
  }, [rootNavigationState?.key, signedPmtilesUrlQuery.error]);

  useEffect(() => {
    if (!mapStyle || !cameraRef.current) {
      return;
    }

    const result = reduceLiveMapInitialFit(initialFitStateRef.current, {
      nowMs: Date.now(),
      type: "markers",
      userIds: markers.map((marker) => marker.userId),
    });
    initialFitStateRef.current = result.state;

    if (result.shouldFit) {
      suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, 600);
      fitLiveMapMarkers({
        camera: cameraRef.current,
        markers,
        padding: cameraPadding,
      });
      scheduleLiveMapInitialFitClose(initialFitTimerRef, initialFitStateRef);
    }
  }, [cameraPadding, mapStyle, markers]);

  useEffect(() => {
    if (
      selectedUserId === null ||
      selectedLatitude === undefined ||
      selectedLongitude === undefined
    ) {
      trackedUserIdRef.current = null;
      trackedCoordinateRef.current = null;
      followSuspendedRef.current = false;
      return;
    }

    const stop = buildLiveMapTrackingCameraStop({
      followSuspended: followSuspendedRef.current,
      latitude: selectedLatitude,
      longitude: selectedLongitude,
      padding: cameraPadding,
      previousLatitude: trackedCoordinateRef.current?.latitude ?? null,
      previousLongitude: trackedCoordinateRef.current?.longitude ?? null,
      previouslyTrackedUserId: trackedUserIdRef.current,
      selectedUserId,
    });

    if (!stop) {
      trackedUserIdRef.current = selectedUserId;
      return;
    }

    if (trackedUserIdRef.current !== selectedUserId) {
      clearLiveMapInitialFitTimer(initialFitTimerRef);
      initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
        type: "user_camera_control",
      }).state;
    }

    followSuspendedRef.current = false;
    trackedUserIdRef.current = selectedUserId;
    trackedCoordinateRef.current = {
      latitude: selectedLatitude,
      longitude: selectedLongitude,
    };
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
    cameraRef.current?.setCamera(stop);
  }, [cameraPadding, selectedLatitude, selectedLongitude, selectedUserId]);

  if (signedPmtilesUrlQuery.isLoading && !mapStyle) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-base text-muted">Loading map…</Text>
      </View>
    );
  }

  if (!mapStyle || (signedPmtilesUrlQuery.isError && !signedPmtilesUrlQuery.isLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <View className="w-full max-w-80 gap-5">
          <Text className="text-center text-base text-muted">The map URL could not be loaded.</Text>
          <Button
            title="Retry"
            onPress={() => {
              void signedPmtilesUrlQuery.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <MapView
        key={pmtilesUrl}
        style={{ flex: 1 }}
        mapStyle={mapStyle}
        attributionEnabled={false}
        logoEnabled={true}
        pitchEnabled={false}
        rotateEnabled={false}
        surfaceView={Platform.OS === "android"}
        onPress={clearSelectionFromReact}
        onRegionDidChange={(feature) => {
          if (!feature.properties.isUserInteraction) {
            return;
          }
          if (Date.now() < suppressUserCameraControlUntilMsRef.current) {
            return;
          }
          noteUserCameraControl();
        }}
        onDidFailLoadingMap={() => {
          if (
            !shouldForceRefreshAfterMapLoadFailure({
              didRetryAfterMapFailure: didRetryAfterMapFailureRef.current,
              isForceRefreshPending: forceRefreshSignedPmtilesUrlMutation.isPending,
              isSignedUrlFetching: signedPmtilesUrlQuery.isFetching,
            })
          ) {
            return;
          }

          didRetryAfterMapFailureRef.current = true;
          forceRefreshSignedPmtilesUrlMutation.mutate();
        }}
        onDidFinishLoadingStyle={() => {
          didRetryAfterMapFailureRef.current = false;
        }}
      >
        <Camera ref={cameraRef} defaultSettings={{ centerCoordinate: [0, 0], zoomLevel: 1.25 }} />
        {markers.map((marker) =>
          marker.isSelf ? (
            <SelfLiveMapPointAnnotation
              key={`${marker.userId}:${annotationRemountTokens[marker.userId] ?? 0}`}
              marker={marker}
              onDeselected={handleAnnotationDeselected}
              onSelected={() => {
                handleAnnotationSelected(marker.userId);
              }}
            />
          ) : (
            <LiveMapPointAnnotation
              key={`${marker.userId}:${annotationRemountTokens[marker.userId] ?? 0}`}
              headingDegrees={null}
              marker={marker}
              onDeselected={handleAnnotationDeselected}
              onSelected={() => {
                handleAnnotationSelected(marker.userId);
              }}
            />
          ),
        )}
      </MapView>
      {hasMarkers ? (
        <Pressable
          accessibilityLabel="Show everyone"
          accessibilityRole="button"
          onPress={fitEveryoneInFrame}
          className="absolute right-3 top-14 size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
        >
          <Icon as={ScanIcon} size={20} className="text-foreground" />
        </Pressable>
      ) : null}
      {selectedMarker ? (
        <LiveMapPersonSheet
          key={selectedMarker.userId}
          battery={selectedMarker.battery}
          image={selectedMarker.image}
          initials={selectedMarker.initials}
          name={selectedMarker.name}
          otherSharedGroupNames={selectedMarker.otherSharedGroupNames}
          timestamp={selectedMarker.timestamp}
          onDismiss={clearSelectionFromReact}
        />
      ) : null}
    </View>
  );
};

const SelfLiveMapPointAnnotation = ({
  marker,
  onDeselected,
  onSelected,
}: {
  marker: LiveMapMarker;
  onDeselected: () => void;
  onSelected: () => void;
}) => {
  const headingDegrees = useSelfDeviceHeading(true);

  return (
    <LiveMapPointAnnotation
      headingDegrees={headingDegrees}
      marker={marker}
      onDeselected={onDeselected}
      onSelected={onSelected}
    />
  );
};

const LiveMapPointAnnotation = ({
  headingDegrees,
  marker,
  onDeselected,
  onSelected,
}: {
  headingDegrees: number | null;
  marker: LiveMapMarker;
  onDeselected: () => void;
  onSelected: () => void;
}) => {
  const annotationRef = useRef<PointAnnotationRef>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android PointAnnotation bitmaps need an explicit refresh when chrome or heading changes
  useEffect(() => {
    annotationRef.current?.refresh();
  }, [headingDegrees, marker.image, marker.initials, marker.ringColor]);

  return (
    <PointAnnotation
      ref={annotationRef}
      id={marker.userId}
      coordinate={[marker.longitude, marker.latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
      onDeselected={onDeselected}
      onSelected={onSelected}
    >
      <LiveMapMarkerPin
        headingDegrees={headingDegrees}
        image={marker.image}
        initials={marker.initials}
        name={marker.name}
        ringColor={marker.ringColor}
        onBitmapContentChange={() => {
          annotationRef.current?.refresh();
        }}
      />
    </PointAnnotation>
  );
};

const clearLiveMapInitialFitTimer = (timerRef: {
  current: ReturnType<typeof setTimeout> | null;
}) => {
  if (timerRef.current === null) {
    return;
  }
  clearTimeout(timerRef.current);
  timerRef.current = null;
};

const suppressUserCameraControlFor = (
  untilMsRef: { current: number },
  animationDurationMs: number,
) => {
  untilMsRef.current = Math.max(untilMsRef.current, Date.now() + animationDurationMs + 100);
};

const scheduleLiveMapInitialFitClose = (
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  stateRef: { current: ReturnType<typeof createLiveMapInitialFitState> },
) => {
  clearLiveMapInitialFitTimer(timerRef);
  const coalesceStartedAtMs = stateRef.current.coalesceStartedAtMs;
  if (stateRef.current.phase !== "coalescing" || coalesceStartedAtMs === null) {
    return;
  }

  const remainingMs = coalesceStartedAtMs + LIVE_MAP_INITIAL_FIT_COALESCE_MS - Date.now();
  timerRef.current = setTimeout(
    () => {
      timerRef.current = null;
      stateRef.current = reduceLiveMapInitialFit(stateRef.current, {
        nowMs: Date.now(),
        type: "coalesce_elapsed",
      }).state;
    },
    Math.max(0, remainingMs),
  );
};
