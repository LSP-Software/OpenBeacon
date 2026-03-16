import type {
  Camera as CameraComponent,
  MapView as MapViewComponent,
} from "@maplibre/maplibre-react-native";
import { router } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import { useSignedPmtilesUrl } from "../../hooks/useSignedPmtilesUrl.ts";
import { getProtomapsMapStyle } from "../../lib/protomaps-style.ts";
import { useColors } from "../../lib/theme.ts";
import { LoadingMap, MapLoadError, UnsupportedMap } from "./shared.tsx";

type MapLibreModule = {
  Camera: typeof CameraComponent;
  MapView: typeof MapViewComponent;
};

function getMapLibreModule(): MapLibreModule | null {
  if (Platform.OS === "web") {
    return null;
  }

  return require("@maplibre/maplibre-react-native") as MapLibreModule;
}

export function NativeMap() {
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

  if (Platform.OS === "web") {
    return <UnsupportedMap />;
  }

  if (signedPmtilesUrlQuery.isLoading && !mapStyle) {
    return <LoadingMap />;
  }

  const mapLibre = getMapLibreModule();

  if (!mapLibre) {
    return <UnsupportedMap />;
  }

  if (!mapStyle) {
    return (
      <MapLoadError
        title="The map URL could not be loaded."
        onRetry={() => {
          void signedPmtilesUrlQuery.refetch();
        }}
      />
    );
  }

  const { Camera, MapView } = mapLibre;

  return (
    <View className="flex-1">
      <MapView
        key={pmtilesUrl}
        style={{ flex: 1 }}
        mapStyle={mapStyle}
        attributionEnabled
        logoEnabled={false}
        compassEnabled={false}
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
}
