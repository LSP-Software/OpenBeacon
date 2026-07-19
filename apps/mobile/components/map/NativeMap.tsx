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
  const didFitMarkersRef = useRef(false);
  const preservedCameraRef = useRef(INITIAL_MAP_CAMERA);
  const pendingCameraRestoreRef = useRef(false);
  const previousPmtilesUrlRef = useRef<string | null>(null);
  const trackedUserIdRef = useRef<string | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
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
    trackedUserIdRef.current = null;
    onSelectUserId?.(null);
    fitMarkersAndPreserveCamera({
      markersToFit: markersRef.current,
      padding: fitEveryonePadding,
    });
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
    if (!rootNavigationState?.key || signedPmtilesUrlQuery.error?.data?.code !== "UNAUTHORIZED") {
      return;
    }

    router.replace("/");
  }, [rootNavigationState?.key, signedPmtilesUrlQuery.error]);

  useEffect(() => {
    if (!mapStyle || !hasMarkers || didFitMarkersRef.current || !cameraRef.current) {
      return;
    }

    didFitMarkersRef.current = true;
    fitMarkersAndPreserveCamera({
      markersToFit: markers,
      padding: cameraPadding,
    });
  }, [cameraPadding, fitMarkersAndPreserveCamera, hasMarkers, mapStyle, markers]);

  useEffect(() => {
    if (
      selectedUserId === null ||
      selectedLatitude === undefined ||
      selectedLongitude === undefined
    ) {
      trackedUserIdRef.current = null;
      return;
    }

    const stop = buildLiveMapTrackingCameraStop({
      latitude: selectedLatitude,
      longitude: selectedLongitude,
      padding: cameraPadding,
      previouslyTrackedUserId: trackedUserIdRef.current,
      selectedUserId,
    });
    trackedUserIdRef.current = selectedUserId;
    cameraRef.current?.setCamera(stop);
    preservedCameraRef.current = mapCameraFromRegionChange({
      latitude: selectedLatitude,
      longitude: selectedLongitude,
      zoomLevel: stop.zoomLevel,
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
        onPress={() => {
          onSelectUserId?.(null);
        }}
        onRegionDidChange={(feature) => {
          const [longitude, latitude] = feature.geometry.coordinates;
          if (longitude === undefined || latitude === undefined) {
            return;
          }

          preservedCameraRef.current = mapCameraFromRegionChange({
            latitude,
            longitude,
            zoomLevel: feature.properties.zoomLevel,
          });
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
              latitude: selectedLatitude,
              longitude: selectedLongitude,
              padding: cameraPadding,
              previouslyTrackedUserId: trackedUserIdRef.current,
              selectedUserId,
            });
            cameraRef.current?.setCamera({
              ...stop,
              animationDuration: 0,
            });
            trackedUserIdRef.current = selectedUserId;
            preservedCameraRef.current = mapCameraFromRegionChange({
              latitude: selectedLatitude,
              longitude: selectedLongitude,
              zoomLevel: stop.zoomLevel,
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
              key={marker.userId}
              marker={marker}
              selected={marker.userId === selectedUserId}
              onSelected={() => {
                onSelectUserId?.(marker.userId);
              }}
            />
          ) : (
            <LiveMapPointAnnotation
              key={marker.userId}
              headingDegrees={null}
              marker={marker}
              selected={marker.userId === selectedUserId}
              onSelected={() => {
                onSelectUserId?.(marker.userId);
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
          onDismiss={() => {
            onSelectUserId?.(null);
          }}
        />
      ) : null}
    </View>
  );
};

const SelfLiveMapPointAnnotation = ({
  marker,
  onSelected,
  selected,
}: {
  marker: LiveMapMarker;
  onSelected: () => void;
  selected: boolean;
}) => {
  const headingDegrees = useSelfDeviceHeading(true);

  return (
    <LiveMapPointAnnotation
      headingDegrees={headingDegrees}
      marker={marker}
      onSelected={onSelected}
      selected={selected}
    />
  );
};

const LiveMapPointAnnotation = ({
  headingDegrees,
  marker,
  onSelected,
  selected,
}: {
  headingDegrees: number | null;
  marker: LiveMapMarker;
  onSelected: () => void;
  selected: boolean;
}) => {
  const annotationRef = useRef<PointAnnotationRef>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: headingDegrees triggers Android bitmap refresh
  useEffect(() => {
    if (!marker.isSelf) {
      return;
    }

    // PointAnnotation snapshots children to a bitmap on Android; refresh when the heading beam rotates or hides.
    annotationRef.current?.refresh();
  }, [headingDegrees, marker.isSelf]);

  return (
    <PointAnnotation
      ref={annotationRef}
      id={marker.userId}
      coordinate={[marker.longitude, marker.latitude]}
      anchor={{ x: 0.5, y: 0.5 }}
      selected={selected}
      onSelected={onSelected}
    >
      <LiveMapMarkerPin
        headingDegrees={headingDegrees}
        image={marker.image}
        initials={marker.initials}
        name={marker.name}
        ringColor={marker.ringColor}
      />
    </PointAnnotation>
  );
};
