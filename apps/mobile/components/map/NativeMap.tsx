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
import {
  INITIAL_MAP_CAMERA,
  mapCameraAfterFittingMarkers,
  mapCameraFromRegionChange,
} from "../../lib/mapPmtilesCameraState.ts";
import {
  MAX_AUTO_FORCE_REFRESH_ATTEMPTS,
  nextMapLoadFailureState,
  shouldForceRefreshAfterMapLoadFailure,
} from "../../lib/mapPmtilesLoadFailure.ts";
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
  const autoForceRefreshAttemptsRef = useRef(0);
  const showRecoverableErrorRef = useRef(false);
  const [showRecoverableError, setShowRecoverableError] = useState(false);
  const applyMapLoadFailureState = (next: {
    autoForceRefreshAttempts: number;
    showRecoverableError: boolean;
  }) => {
    autoForceRefreshAttemptsRef.current = next.autoForceRefreshAttempts;
    showRecoverableErrorRef.current = next.showRecoverableError;
    setShowRecoverableError(next.showRecoverableError);
  };
  const forceRefreshSignedPmtilesUrlMutation = useMutation({
    ...trpc.maps.forceRefreshSignedPmtilesUrl.mutationOptions(),
    onSuccess: (signedPmtilesUrl) => {
      queryClient.setQueryData(trpc.maps.getSignedPmtilesUrl.queryKey(), signedPmtilesUrl);
    },
    onError: () => {
      applyMapLoadFailureState(
        nextMapLoadFailureState({
          autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
          event: "force_refresh_failed",
        }),
      );
    },
  });
  const rootNavigationState = useRootNavigationState();
  const cameraRef = useRef<CameraRef>(null);
  const initialFitStateRef = useRef(createLiveMapInitialFitState());
  const initialFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preservedCameraRef = useRef(INITIAL_MAP_CAMERA);
  const pendingCameraRestoreRef = useRef(false);
  const previousPmtilesUrlRef = useRef<string | null>(null);
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
  if (previousPmtilesUrlRef.current !== pmtilesUrl) {
    if (previousPmtilesUrlRef.current !== null && pmtilesUrl !== null) {
      pendingCameraRestoreRef.current = true;
    }
    previousPmtilesUrlRef.current = pmtilesUrl;
  }
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

  const fitMarkersAndPreserveCamera = ({
    markersToFit,
    padding,
  }: {
    markersToFit: readonly LiveMapMarker[];
    padding: {
      paddingBottom: number;
      paddingLeft: number;
      paddingRight: number;
      paddingTop: number;
    };
  }) => {
    fitLiveMapMarkers({
      camera: cameraRef.current,
      markers: markersToFit,
      padding,
    });
    preservedCameraRef.current = mapCameraAfterFittingMarkers({
      markers: markersToFit,
      previousCamera: preservedCameraRef.current,
    });
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
    fitMarkersAndPreserveCamera({
      markersToFit: markersRef.current,
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

  const retryMapLoad = () => {
    if (forceRefreshSignedPmtilesUrlMutation.isPending) {
      return;
    }

    applyMapLoadFailureState(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
        event: "manual_retry",
      }),
    );
    applyMapLoadFailureState(
      nextMapLoadFailureState({
        autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
        event: "auto_force_refresh_started",
      }),
    );
    forceRefreshSignedPmtilesUrlMutation.mutate();
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
      preservedCameraRef.current = mapCameraAfterFittingMarkers({
        markers,
        previousCamera: preservedCameraRef.current,
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
    preservedCameraRef.current = mapCameraFromRegionChange({
      latitude: selectedLatitude,
      longitude: selectedLongitude,
      zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
    });
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
          const [longitude, latitude] = feature.geometry.coordinates;
          if (longitude !== undefined && latitude !== undefined) {
            preservedCameraRef.current = mapCameraFromRegionChange({
              latitude,
              longitude,
              zoomLevel: feature.properties.zoomLevel,
            });
          }

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
              autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
              isForceRefreshPending: forceRefreshSignedPmtilesUrlMutation.isPending,
              isSignedUrlFetching: signedPmtilesUrlQuery.isFetching,
              showRecoverableError: showRecoverableErrorRef.current,
            })
          ) {
            if (
              !showRecoverableErrorRef.current &&
              !forceRefreshSignedPmtilesUrlMutation.isPending &&
              !signedPmtilesUrlQuery.isFetching &&
              autoForceRefreshAttemptsRef.current >= MAX_AUTO_FORCE_REFRESH_ATTEMPTS
            ) {
              applyMapLoadFailureState(
                nextMapLoadFailureState({
                  autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
                  event: "auto_retries_exhausted",
                }),
              );
            }
            return;
          }

          applyMapLoadFailureState(
            nextMapLoadFailureState({
              autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
              event: "auto_force_refresh_started",
            }),
          );
          forceRefreshSignedPmtilesUrlMutation.mutate();
        }}
        onDidFinishLoadingStyle={() => {
          applyMapLoadFailureState(
            nextMapLoadFailureState({
              autoForceRefreshAttempts: autoForceRefreshAttemptsRef.current,
              event: "style_loaded",
            }),
          );

          if (!pendingCameraRestoreRef.current) {
            return;
          }

          pendingCameraRestoreRef.current = false;

          if (
            selectedUserId !== null &&
            selectedLatitude !== undefined &&
            selectedLongitude !== undefined
          ) {
            const stop = buildLiveMapTrackingCameraStop({
              followSuspended: false,
              latitude: selectedLatitude,
              longitude: selectedLongitude,
              padding: cameraPadding,
              previousLatitude: null,
              previousLongitude: null,
              previouslyTrackedUserId: null,
              selectedUserId,
            });
            if (!stop) {
              return;
            }
            cameraRef.current?.setCamera({
              ...stop,
              animationDuration: 0,
            });
            trackedUserIdRef.current = selectedUserId;
            trackedCoordinateRef.current = {
              latitude: selectedLatitude,
              longitude: selectedLongitude,
            };
            followSuspendedRef.current = false;
            preservedCameraRef.current = mapCameraFromRegionChange({
              latitude: selectedLatitude,
              longitude: selectedLongitude,
              zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
            });
            return;
          }

          cameraRef.current?.setCamera({
            animationDuration: 0,
            centerCoordinate: preservedCameraRef.current.centerCoordinate,
            zoomLevel: preservedCameraRef.current.zoomLevel,
          });
        }}
      >
        <Camera ref={cameraRef} defaultSettings={preservedCameraRef.current} />
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
      {showRecoverableError ? (
        <View className="absolute inset-0 items-center justify-center bg-background/90 px-6">
          <View className="w-full max-w-80 gap-5">
            <Text className="text-center text-base text-muted">The map could not be loaded.</Text>
            <Button
              disabled={forceRefreshSignedPmtilesUrlMutation.isPending}
              title="Retry"
              onPress={retryMapLoad}
            />
          </View>
        </View>
      ) : null}
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
