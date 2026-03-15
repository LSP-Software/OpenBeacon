import type {
  Camera as CameraComponent,
  MapView as MapViewComponent,
} from "@maplibre/maplibre-react-native";
import { Platform, View } from "react-native";
import { getProtomapsStyleUrl } from "../../lib/protomaps-style.ts";
import { useColors } from "../../lib/theme.ts";
import { MissingMapConfig, UnsupportedMap } from "./shared.tsx";

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
  const mapStyle = getProtomapsStyleUrl(colors.isDark ? "dark" : "light");

  if (Platform.OS === "web") {
    return <UnsupportedMap />;
  }

  if (!mapStyle) {
    return <MissingMapConfig />;
  }

  const mapLibre = getMapLibreModule();

  if (!mapLibre) {
    return <UnsupportedMap />;
  }

  const { Camera, MapView } = mapLibre;

  return (
    <View className="flex-1">
      <MapView
        style={{ flex: 1 }}
        mapStyle={mapStyle}
        attributionEnabled
        logoEnabled={false}
        compassEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        surfaceView={Platform.OS === "android"}
      >
        <Camera centerCoordinate={[0, 0]} zoomLevel={1.25} />
      </MapView>
    </View>
  );
}
