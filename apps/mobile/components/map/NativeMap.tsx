import { Camera, MapView } from "@maplibre/maplibre-react-native";
import { router } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { Button, Platform, View } from "react-native";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { getProtomapsMapStyle } from "../../lib/protomaps-style.ts";
import { useColors } from "../../lib/theme.ts";
import { Text } from "../Text.tsx";
import { LoadingMap } from "./shared.tsx";

export const NativeMap = () => {
  const colors = useColors();
  const signedPmtilesUrlQuery = useSignedPmtilesUrl();
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

    return getProtomapsMapStyle(colors.isDark ? "dark" : "light", pmtilesUrl);
  }, [colors.isDark, pmtilesUrl]);

  useEffect(() => {
    if (signedPmtilesUrlQuery.error?.data?.code !== "UNAUTHORIZED") {
      return;
    }

    router.replace("/");
  }, [signedPmtilesUrlQuery.error]);

  if (signedPmtilesUrlQuery.isLoading && !mapStyle) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-base text-muted">Loading map…</Text>
      </View>
    );
  }

  if (!mapStyle) {
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
