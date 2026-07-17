import { Camera, MapView, MarkerView } from "@maplibre/maplibre-react-native";
import { useMutation } from "@tanstack/react-query";
import { router, useRootNavigationState } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { Button, Platform, View } from "react-native";
import { Text } from "../../components/ui/Text.tsx";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { queryClient, trpc } from "../../lib/api.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { getProtomapsMapStyle } from "../../lib/protomaps-style.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";
import { LiveMapCallout } from "./LiveMapCallout.tsx";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";

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
  const signedPmtilesUrlQuery = useSignedPmtilesUrl();
  const forceRefreshSignedPmtilesUrlMutation = useMutation({
    ...trpc.maps.forceRefreshSignedPmtilesUrl.mutationOptions(),
    onSuccess: (signedPmtilesUrl) => {
      queryClient.setQueryData(trpc.maps.getSignedPmtilesUrl.queryKey(), signedPmtilesUrl);
    },
  });
  const rootNavigationState = useRootNavigationState();
  const didRetryAfterMapFailureRef = useRef(false);
  const lastPmtilesUrlRef = useRef<string | null>(null);
  const suppressMapPressRef = useRef(false);
  const pmtilesUrl = signedPmtilesUrlQuery.data?.url ?? null;
  const selectedMarker = markers.find((marker) => marker.userId === selectedUserId) ?? null;

  if (lastPmtilesUrlRef.current !== pmtilesUrl) {
    lastPmtilesUrlRef.current = pmtilesUrl;
    didRetryAfterMapFailureRef.current = false;
  }

  const mapStyle = useMemo(() => {
    if (!pmtilesUrl) {
      return null;
    }

    return getProtomapsMapStyle(mapTheme, pmtilesUrl);
  }, [mapTheme, pmtilesUrl]);

  useEffect(() => {
    if (!rootNavigationState?.key || signedPmtilesUrlQuery.error?.data?.code !== "UNAUTHORIZED") {
      return;
    }

    router.replace("/");
  }, [rootNavigationState?.key, signedPmtilesUrlQuery.error]);

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
          if (suppressMapPressRef.current) {
            suppressMapPressRef.current = false;
            return;
          }

          onSelectUserId?.(null);
        }}
        onDidFailLoadingMap={() => {
          if (
            didRetryAfterMapFailureRef.current ||
            signedPmtilesUrlQuery.isFetching ||
            forceRefreshSignedPmtilesUrlMutation.isPending
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
        <Camera centerCoordinate={[0, 0]} zoomLevel={1.25} />
        {markers.map((marker) => (
          <MarkerView
            key={marker.userId}
            coordinate={[marker.longitude, marker.latitude]}
            allowOverlap
            isSelected={marker.userId === selectedUserId}
          >
            <LiveMapMarkerPin
              image={marker.image}
              initials={marker.initials}
              isSelf={marker.isSelf}
              name={marker.name}
              ringColor={marker.ringColor}
              onPress={() => {
                suppressMapPressRef.current = true;
                onSelectUserId?.(marker.userId);
              }}
            />
          </MarkerView>
        ))}
      </MapView>
      {selectedMarker ? (
        <View className="absolute bottom-6 left-4 right-4" pointerEvents="box-none">
          <LiveMapCallout
            battery={selectedMarker.battery}
            name={selectedMarker.name}
            otherSharedGroupNames={selectedMarker.otherSharedGroupNames}
            timestamp={selectedMarker.timestamp}
          />
        </View>
      ) : null}
    </View>
  );
};
