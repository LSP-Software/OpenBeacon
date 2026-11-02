import {
  Camera,
  type CameraRef,
  type CameraStop,
  MapView,
  type MapViewRef,
  MarkerView,
  PointAnnotation,
  type PointAnnotationRef,
} from "@maplibre/maplibre-react-native";
import { tryCatch } from "@openbeacon/shared";
import { useMutation } from "@tanstack/react-query";
import { Paths } from "expo-file-system";
import { router, useRootNavigationState } from "expo-router";
import { ArrowUpIcon, LocateFixedIcon, MapPinIcon, ScanIcon } from "lucide-react-native";
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
import {
  buildLiveMapTrackingCameraStop,
  shouldSuspendLiveMapFollowOnRegionChange,
} from "../../lib/liveMapTrackingCamera.ts";
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
import { MAP_CONTROL_CLEARANCE, mapEdgePoint } from "../../lib/mapEdgePoint.ts";
import { mapViewportPoint } from "../../lib/mapViewportPoint.ts";
import { spaceMapEdgePoints } from "../../lib/spaceMapEdgePoints.ts";
import { getProtomapsMapStyle } from "../../lib/protomaps-style.ts";
import { storage } from "../../lib/storage.ts";
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
  const [showSymbols, setShowSymbols] = useState(
    () => storage.getBoolean("map.showSymbols") ?? false,
  );
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
  const mapRef = useRef<MapViewRef>(null);
  const mapSizeRef = useRef({ width: 0, height: 0 });
  const sheetHeightRef = useRef<number | null>(null);
  const edgeHasSheetRef = useRef(false);
  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeRequestRef = useRef(0);
  const edgeSelectionRevisionRef = useRef(0);
  const edgeLayoutRevisionRef = useRef(0);
  const edgeCameraRevisionRef = useRef(0);
  const edgeBoundsRef = useRef<readonly [readonly number[], readonly number[]] | null>(null);
  const edgeInFlightRef = useRef(false);
  const edgeDirtyRef = useRef(false);
  const edgeControlsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const edgeSuppressedUserIdRef = useRef<string | null>(null);
  const edgeSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [edgeMarkers, setEdgeMarkers] = useState<
    Array<{ angle: number; userId: string; x: number; y: number }>
  >([]);
  const edgeMarkersRef = useRef(edgeMarkers);
  edgeMarkersRef.current = edgeMarkers;
  const cameraCommandReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  edgeHasSheetRef.current = selectedMarker !== null;
  const selfMarker = markers.find((marker) => marker.isSelf) ?? null;
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
  const cameraPaddingRef = useRef(cameraPadding);
  cameraPaddingRef.current = cameraPadding;

  const mapStyle = useMemo(() => {
    if (!pmtilesUrl) {
      return null;
    }

    return getProtomapsMapStyle(
      mapTheme,
      pmtilesUrl,
      Platform.OS === "ios"
        ? `${Paths.bundle.uri}/map/fonts/{fontstack}/{range}.pbf`
        : "asset://map-assets/fonts/{fontstack}/{range}.pbf",
      Platform.OS === "ios" ? `${Paths.bundle.uri}/map/sprites` : "asset://map-assets/sprites",
      showSymbols,
    );
  }, [mapTheme, pmtilesUrl, showSymbols]);

  const cameraDefaultSettings = useMemo(() => {
    void pmtilesUrl;
    return {
      centerCoordinate: [...preservedCameraRef.current.centerCoordinate] as [number, number],
      zoomLevel: preservedCameraRef.current.zoomLevel,
    };
  }, [pmtilesUrl]);

  const clearSelectionFromReact = () => {
    pendingDeselectClearRef.current = false;
    const previouslySelectedUserId = selectedUserIdRef.current;
    if (Platform.OS !== "android" && previouslySelectedUserId !== null) {
      setAnnotationRemountTokens((tokens) => ({
        ...tokens,
        [previouslySelectedUserId]: (tokens[previouslySelectedUserId] ?? 0) + 1,
      }));
    }
    onSelectUserId?.(null);
  };
  const handleAnnotationDeselected = (userId: string) => {
    if (edgeMarkersRef.current.some((edge) => edge.userId === userId)) return;
    pendingDeselectClearRef.current = true;
    queueMicrotask(() => {
      if (!pendingDeselectClearRef.current) {
        return;
      }
      pendingDeselectClearRef.current = false;
      if (!edgeMarkersRef.current.some((edge) => edge.userId === userId)) onSelectUserId?.(null);
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
    const animationDuration = fitLiveMapMarkers({
      camera: cameraRef.current,
      markers: markersToFit,
      padding,
    });
    if (animationDuration !== null) {
      scheduleCameraCommandRelease(cameraCommandReleaseTimerRef, cameraRef, animationDuration);
    }
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

  const goToCurrentLocation = () => {
    const currentSelfMarker = markersRef.current.find((marker) => marker.isSelf);
    if (!currentSelfMarker) {
      return;
    }

    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;

    followSuspendedRef.current = false;

    if (selectedUserIdRef.current !== currentSelfMarker.userId) {
      handleAnnotationSelected(currentSelfMarker.userId);
    }

    const stop = buildLiveMapTrackingCameraStop({
      followSuspended: false,
      latitude: currentSelfMarker.latitude,
      longitude: currentSelfMarker.longitude,
      padding: {
        paddingBottom: 220,
        paddingLeft: cameraPaddingRef.current.paddingLeft,
        paddingRight: cameraPaddingRef.current.paddingRight,
        paddingTop: cameraPaddingRef.current.paddingTop,
      },
      previousLatitude: null,
      previousLongitude: null,
      previouslyTrackedUserId: null,
      selectedUserId: currentSelfMarker.userId,
    });
    if (!stop) {
      return;
    }

    trackedUserIdRef.current = currentSelfMarker.userId;
    trackedCoordinateRef.current = {
      latitude: currentSelfMarker.latitude,
      longitude: currentSelfMarker.longitude,
    };
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
    setCameraAndRelease(cameraCommandReleaseTimerRef, cameraRef, stop);
    preservedCameraRef.current = mapCameraFromRegionChange({
      latitude: currentSelfMarker.latitude,
      longitude: currentSelfMarker.longitude,
      zoomLevel: stop.zoomLevel ?? preservedCameraRef.current.zoomLevel,
    });
  };

  const edgeViewportHeight = () =>
    Math.max(
      0,
      mapSizeRef.current.height -
        (edgeHasSheetRef.current ? (sheetHeightRef.current ?? 220) + 12 : 0),
    );

  const applyEdgeMarkers = (
    projected: typeof edgeMarkers,
    occupied: readonly { x: number; y: number }[],
  ) => {
    const next = spaceMapEdgePoints({
      points: projected,
      occupied,
      previous: edgeMarkersRef.current,
      controls: edgeControlsRef.current,
      width: mapSizeRef.current.width,
      height: edgeViewportHeight(),
    });
    setEdgeMarkers((current) =>
      current.length === next.length &&
      current.every((edge, index) => {
        const candidate = next[index];
        return (
          candidate?.userId === edge.userId &&
          candidate.x === edge.x &&
          candidate.y === edge.y &&
          candidate.angle === edge.angle
        );
      })
        ? current
        : next,
    );
  };

  const updateEdgeMarkers = () => {
    const bounds = edgeBoundsRef.current;
    const controls = edgeControlsRef.current;
    const { width, height } = mapSizeRef.current;
    if (bounds && controls && mapViewportPoint({ bounds, coordinate: [0, 0], width, height })) {
      edgeDirtyRef.current = false;
      const next: typeof edgeMarkers = [];
      const occupied: Array<{ x: number; y: number }> = [];
      for (const marker of markersRef.current) {
        const point = mapViewportPoint({
          bounds,
          coordinate: [marker.longitude, marker.latitude],
          width,
          height,
        });
        if (!point) continue;
        const edge = mapEdgePoint({ width, height: edgeViewportHeight(), point, controls });
        if (edge && marker.userId !== edgeSuppressedUserIdRef.current) {
          next.push({ userId: marker.userId, ...edge });
        } else {
          occupied.push({ x: point[0], y: point[1] });
        }
      }
      applyEdgeMarkers(next, occupied);
      return;
    }
    edgeDirtyRef.current = true;
    if (edgeTimerRef.current !== null || edgeInFlightRef.current) return;
    edgeTimerRef.current = setTimeout(() => {
      edgeTimerRef.current = null;
      const map = mapRef.current;
      const { width, height } = mapSizeRef.current;
      if (!map || !width || !height || !edgeControlsRef.current) return;
      edgeDirtyRef.current = false;
      edgeInFlightRef.current = true;
      const request = edgeRequestRef.current;
      const selectionRevision = edgeSelectionRevisionRef.current;
      const layoutRevision = edgeLayoutRevisionRef.current;
      const cameraRevision = edgeCameraRevisionRef.current;
      void (async () => {
        const result = await tryCatch(
          Promise.all(
            markersRef.current.map(async (marker) => {
              const point = await map.getPointInView([marker.longitude, marker.latitude]);
              const edge = mapEdgePoint({
                width,
                height: edgeViewportHeight(),
                point,
                controls: edgeControlsRef.current,
              });
              return { userId: marker.userId, point, edge };
            }),
          ),
        );
        if (request !== edgeRequestRef.current) return;
        edgeInFlightRef.current = false;
        if (
          selectionRevision !== edgeSelectionRevisionRef.current ||
          layoutRevision !== edgeLayoutRevisionRef.current ||
          cameraRevision !== edgeCameraRevisionRef.current ||
          map !== mapRef.current
        ) {
          edgeDirtyRef.current = true;
        } else if (!result.error) {
          const next: typeof edgeMarkers = [];
          const occupied: Array<{ x: number; y: number }> = [];
          for (const marker of result.data) {
            if (marker.edge && marker.userId !== edgeSuppressedUserIdRef.current) {
              next.push({ userId: marker.userId, ...marker.edge });
            } else {
              occupied.push({ x: marker.point[0], y: marker.point[1] });
            }
          }
          applyEdgeMarkers(next, occupied);
        }
        if (edgeDirtyRef.current) updateEdgeMarkers();
      })();
    }, 16);
  };

  const goToEdgeMarker = (userId: string) => {
    const marker = markersRef.current.find((item) => item.userId === userId);
    if (!marker) return;
    edgeSuppressedUserIdRef.current = userId;
    edgeSelectionRevisionRef.current += 1;
    if (edgeSuppressionTimerRef.current !== null) clearTimeout(edgeSuppressionTimerRef.current);
    setEdgeMarkers((current) => current.filter((edge) => edge.userId !== userId));
    if (selectedUserIdRef.current !== userId) handleAnnotationSelected(userId);
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    followSuspendedRef.current = false;
    const stop = buildLiveMapTrackingCameraStop({
      followSuspended: false,
      latitude: marker.latitude,
      longitude: marker.longitude,
      padding: { ...cameraPaddingRef.current, paddingBottom: 220 },
      previousLatitude: null,
      previousLongitude: null,
      previouslyTrackedUserId: null,
      selectedUserId: userId,
    });
    if (!stop) {
      edgeSuppressedUserIdRef.current = null;
      edgeSelectionRevisionRef.current += 1;
      updateEdgeMarkers();
      return;
    }
    edgeSuppressionTimerRef.current = setTimeout(() => {
      edgeSuppressionTimerRef.current = null;
      edgeSuppressedUserIdRef.current = null;
      edgeSelectionRevisionRef.current += 1;
      updateEdgeMarkers();
    }, stop.animationDuration + 50);
    trackedUserIdRef.current = userId;
    trackedCoordinateRef.current = { latitude: marker.latitude, longitude: marker.longitude };
    suppressUserCameraControlFor(suppressUserCameraControlUntilMsRef, stop.animationDuration);
    setCameraAndRelease(cameraCommandReleaseTimerRef, cameraRef, stop);
  };

  const noteUserCameraControl = () => {
    if (edgeSuppressedUserIdRef.current !== null) {
      edgeSuppressedUserIdRef.current = null;
      edgeSelectionRevisionRef.current += 1;
      if (edgeSuppressionTimerRef.current !== null) clearTimeout(edgeSuppressionTimerRef.current);
      edgeSuppressionTimerRef.current = null;
      updateEdgeMarkers();
    }
    clearLiveMapInitialFitTimer(initialFitTimerRef);
    initialFitStateRef.current = reduceLiveMapInitialFit(initialFitStateRef.current, {
      type: "user_camera_control",
    }).state;
    followSuspendedRef.current = true;
  };

  const maybeSuspendFollowFromRegionChange = (feature: {
    properties: {
      animated: boolean;
      isUserInteraction: boolean;
    };
  }) => {
    if (
      !shouldSuspendLiveMapFollowOnRegionChange({
        animated: feature.properties.animated,
        isUserInteraction: feature.properties.isUserInteraction,
        nowMs: Date.now(),
        suppressUserCameraControlUntilMs: suppressUserCameraControlUntilMsRef.current,
      })
    ) {
      return;
    }
    noteUserCameraControl();
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
      clearCameraCommandReleaseTimer(cameraCommandReleaseTimerRef);
      clearLiveMapInitialFitTimer(initialFitTimerRef);
      if (edgeTimerRef.current !== null) clearTimeout(edgeTimerRef.current);
      if (edgeSuppressionTimerRef.current !== null) clearTimeout(edgeSuppressionTimerRef.current);
      edgeRequestRef.current += 1;
      edgeInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    updateEdgeMarkers();
  }, [markers]);

  useEffect(() => {
    sheetHeightRef.current = null;
    edgeLayoutRevisionRef.current += 1;
    updateEdgeMarkers();
  }, [selectedMarker?.userId]);

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
      const animationDuration = fitLiveMapMarkers({
        camera: cameraRef.current,
        markers,
        padding: cameraPadding,
      });
      if (animationDuration !== null) {
        scheduleCameraCommandRelease(cameraCommandReleaseTimerRef, cameraRef, animationDuration);
      }
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
    setCameraAndRelease(cameraCommandReleaseTimerRef, cameraRef, stop);
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
    <View
      className="flex-1"
      onLayout={(event) => {
        mapSizeRef.current = event.nativeEvent.layout;
        edgeLayoutRevisionRef.current += 1;
        updateEdgeMarkers();
      }}
    >
      <MapView
        key={pmtilesUrl}
        ref={mapRef}
        style={{ flex: 1 }}
        mapStyle={mapStyle}
        attributionEnabled={false}
        logoEnabled={true}
        pitchEnabled={false}
        rotateEnabled={false}
        regionDidChangeDebounceTime={0}
        surfaceView={Platform.OS === "android"}
        onPress={clearSelectionFromReact}
        onRegionIsChanging={(feature) => {
          edgeCameraRevisionRef.current += 1;
          edgeBoundsRef.current = feature.properties.visibleBounds ?? null;
          maybeSuspendFollowFromRegionChange(feature);
          updateEdgeMarkers();
        }}
        onRegionDidChange={(feature) => {
          edgeCameraRevisionRef.current += 1;
          edgeBoundsRef.current = feature.properties.visibleBounds ?? null;
          const [longitude, latitude] = feature.geometry.coordinates;
          if (longitude !== undefined && latitude !== undefined) {
            preservedCameraRef.current = mapCameraFromRegionChange({
              latitude,
              longitude,
              zoomLevel: feature.properties.zoomLevel,
            });
          }

          maybeSuspendFollowFromRegionChange(feature);
          updateEdgeMarkers();
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
          updateEdgeMarkers();
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
            setCameraAndRelease(cameraCommandReleaseTimerRef, cameraRef, {
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

          setCameraAndRelease(cameraCommandReleaseTimerRef, cameraRef, {
            animationDuration: 0,
            centerCoordinate: preservedCameraRef.current.centerCoordinate,
            zoomLevel: preservedCameraRef.current.zoomLevel,
          });
        }}
      >
        <Camera ref={cameraRef} defaultSettings={cameraDefaultSettings} />
        {markers.map((marker) =>
          edgeMarkers.some((edge) => edge.userId === marker.userId) ? null : marker.isSelf ? (
            <SelfLiveMapPointAnnotation
              key={`${marker.userId}:${annotationRemountTokens[marker.userId] ?? 0}`}
              marker={marker}
              onDeselected={() => {
                handleAnnotationDeselected(marker.userId);
              }}
              onSelected={() => {
                handleAnnotationSelected(marker.userId);
              }}
            />
          ) : (
            <LiveMapPointAnnotation
              key={`${marker.userId}:${annotationRemountTokens[marker.userId] ?? 0}`}
              headingDegrees={null}
              marker={marker}
              onDeselected={() => {
                handleAnnotationDeselected(marker.userId);
              }}
              onSelected={() => {
                handleAnnotationSelected(marker.userId);
              }}
            />
          ),
        )}
      </MapView>
      {edgeMarkers.map((edge) => {
        const marker = markers.find((item) => item.userId === edge.userId);
        if (!marker) return null;
        return (
          <Pressable
            key={edge.userId}
            accessibilityRole="button"
            accessibilityLabel={`Go to ${marker.name}`}
            onPress={() => goToEdgeMarker(marker.userId)}
            style={{ position: "absolute", left: edge.x - 24, top: edge.y - 24 }}
          >
            <LiveMapMarkerPin
              image={marker.image}
              initials={marker.initials}
              name={marker.name}
              ringColor={marker.ringColor}
            />
            <View
              pointerEvents="none"
              className="absolute bottom-0 right-0 size-5 items-center justify-center rounded-full border border-border bg-card"
              style={{ transform: [{ rotate: `${edge.angle}deg` }] }}
            >
              <Icon as={ArrowUpIcon} size={13} className="text-foreground" />
            </View>
          </Pressable>
        );
      })}
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
      <View
        className="absolute right-3 top-14 gap-2"
        onLayout={(event) => {
          const controls = event.nativeEvent.layout;
          edgeControlsRef.current = controls;
          edgeLayoutRevisionRef.current += 1;
          setEdgeMarkers((current) =>
            current.filter(
              (edge) =>
                edge.x <= controls.x - MAP_CONTROL_CLEARANCE ||
                edge.x >= controls.x + controls.width + MAP_CONTROL_CLEARANCE ||
                edge.y <= controls.y - MAP_CONTROL_CLEARANCE ||
                edge.y >= controls.y + controls.height + MAP_CONTROL_CLEARANCE,
            ),
          );
          updateEdgeMarkers();
        }}
      >
        <Pressable
          accessibilityLabel="Show map names and symbols"
          accessibilityRole="switch"
          accessibilityState={{ checked: showSymbols }}
          onPress={() => {
            const next = !showSymbols;
            storage.set("map.showSymbols", next);
            setShowSymbols(next);
          }}
          className="size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
        >
          <Icon
            as={MapPinIcon}
            size={20}
            className={showSymbols ? "text-foreground" : "text-muted"}
          />
        </Pressable>
        {hasMarkers ? (
          <>
            <Pressable
              accessibilityLabel="Show everyone"
              accessibilityRole="button"
              onPress={fitEveryoneInFrame}
              className="size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
            >
              <Icon as={ScanIcon} size={20} className="text-foreground" />
            </Pressable>
            {selfMarker ? (
              <Pressable
                accessibilityLabel="Go to current location"
                accessibilityRole="button"
                onPress={goToCurrentLocation}
                className="size-11 items-center justify-center rounded-full border border-border bg-card shadow-sm shadow-black/10"
              >
                <Icon as={LocateFixedIcon} size={20} className="text-foreground" />
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>
      {selectedMarker ? (
        <LiveMapPersonSheet
          key={selectedMarker.userId}
          battery={selectedMarker.battery}
          image={selectedMarker.image}
          initials={selectedMarker.initials}
          name={selectedMarker.name}
          otherSharedGroupNames={selectedMarker.otherSharedGroupNames}
          timestamp={selectedMarker.timestamp}
          onHeightChange={(height) => {
            sheetHeightRef.current = height;
            edgeLayoutRevisionRef.current += 1;
            updateEdgeMarkers();
          }}
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

  useEffect(() => {
    // Android PointAnnotation bitmaps need an explicit refresh when chrome or heading changes
    annotationRef.current?.refresh();
  }, [headingDegrees, marker.image, marker.initials, marker.ringColor]);

  if (Platform.OS === "android") {
    return (
      <MarkerView coordinate={[marker.longitude, marker.latitude]} allowOverlap>
        <Pressable
          onPress={onSelected}
          accessibilityRole="button"
          accessibilityLabel={marker.name}
          style={{ alignSelf: "flex-start" }}
        >
          <LiveMapMarkerPin
            headingDegrees={headingDegrees}
            image={marker.image}
            initials={marker.initials}
            name={marker.name}
            ringColor={marker.ringColor}
          />
        </Pressable>
      </MarkerView>
    );
  }

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

const clearCameraCommandReleaseTimer = (timerRef: {
  current: ReturnType<typeof setTimeout> | null;
}) => {
  if (timerRef.current === null) {
    return;
  }
  clearTimeout(timerRef.current);
  timerRef.current = null;
};

const scheduleCameraCommandRelease = (
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  cameraRef: { current: CameraRef | null },
  animationDurationMs: number,
) => {
  clearCameraCommandReleaseTimer(timerRef);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    cameraRef.current?.setCamera({ animationDuration: 0 });
  }, animationDurationMs + 50);
};

const setCameraAndRelease = (
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  cameraRef: { current: CameraRef | null },
  stop: CameraStop,
) => {
  if (!cameraRef.current) {
    return;
  }
  cameraRef.current.setCamera(stop);
  scheduleCameraCommandRelease(timerRef, cameraRef, stop.animationDuration ?? 0);
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
