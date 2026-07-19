import type { CameraRef } from "@maplibre/maplibre-react-native";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

export const fitLiveMapMarkers = ({
  camera,
  markers,
  padding,
}: {
  camera: CameraRef | null;
  markers: readonly LiveMapMarker[];
  padding: {
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
  };
}) => {
  const [firstMarker, ...rest] = markers;
  if (!camera || !firstMarker) {
    return null;
  }

  if (rest.length === 0) {
    camera.setCamera({
      animationDuration: 600,
      centerCoordinate: [firstMarker.longitude, firstMarker.latitude],
      padding,
      zoomLevel: 14,
    });
    return 600;
  }

  let north = firstMarker.latitude;
  let south = firstMarker.latitude;
  let east = firstMarker.longitude;
  let west = firstMarker.longitude;

  for (const marker of rest) {
    north = Math.max(north, marker.latitude);
    south = Math.min(south, marker.latitude);
    east = Math.max(east, marker.longitude);
    west = Math.min(west, marker.longitude);
  }

  camera.fitBounds(
    [east, north],
    [west, south],
    [padding.paddingTop, padding.paddingRight, padding.paddingBottom, padding.paddingLeft],
    600,
  );
  return 600;
};
