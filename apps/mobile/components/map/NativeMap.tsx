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
import { useEffect, useMemo, useRef } from "react";
import { Button, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../../components/ui/Text.tsx";
import { useSelfDeviceHeading } from "../../hooks/useSelfDeviceHeading.ts";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { queryClient, trpc } from "../../lib/api.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { fitLiveMapMarkers } from "../../lib/fitLiveMapMarkers.ts";
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
  const didFitMarkersRef = useRef(false);
  const didRetryAfterMapFailureRef = useRef(false);
  const lastPmtilesUrlRef = useRef<string | null>(null);
  const trackedUserIdRef = useRef<string | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
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
    didFitMarkersRef.current = false;
    trackedUserIdRef.current = null;
  }

  const mapStyle = useMemo(() => {
    if (!pmtilesUrl) {
      return null;
    }

    return getProtomapsMapStyle(mapTheme, pmtilesUrl);
  }, [mapTheme, pmtilesUrl]);

  const fitEveryoneInFrame = () => {
    trackedUserIdRef.current = null;
    onSelectUserId?.(null);
    fitLiveMapMarkers({
      camera: cameraRef.current,
      markers: markersRef.current,
      padding: fitEveryonePadding,
    });
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
    fitLiveMapMarkers({
      camera: cameraRef.current,
      markers,
      padding: cameraPadding,
    });
  }, [cameraPadding, hasMarkers, mapStyle, markers]);

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

  useEffect(() => {
    if (!marker.isSelf) {
      return;
    }

    // PointAnnotation snapshots children to a bitmap on Android; refresh when the heading beam rotates or hides.
    void headingDegrees;
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
