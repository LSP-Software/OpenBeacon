import { Camera, MapView } from "@maplibre/maplibre-react-native";
import { router, useRootNavigationState } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { Button, Platform, View } from "react-native";
import { Text } from "../../components/ui/Text.tsx";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { getProtomapsMapStyle } from "../../lib/protomaps-style.ts";
import { useTheme } from "../../providers/ThemeProvider.tsx";

export const NativeMap = () => {
  const { mapTheme } = useTheme();
  const signedPmtilesUrlQuery = useSignedPmtilesUrl();
  const rootNavigationState = useRootNavigationState();
  const didRetryAfterMapFailureRef = useRef(false);
  const lastPmtilesUrlRef = useRef<string | null>(null);
  const pmtilesUrl = signedPmtilesUrlQuery.data?.url ?? null;

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
        onDidFailLoadingMap={() => {
          if (didRetryAfterMapFailureRef.current || signedPmtilesUrlQuery.isFetching) {
            return;
          }

          didRetryAfterMapFailureRef.current = true;
          void signedPmtilesUrlQuery.refetch();
        }}
        onDidFinishLoadingStyle={() => {
          didRetryAfterMapFailureRef.current = false;
        }}
      >
        <Camera centerCoordinate={[0, 0]} zoomLevel={1.25} />
      </MapView>
    </View>
  );
};
