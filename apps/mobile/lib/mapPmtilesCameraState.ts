import { liveMapMarkersCenter } from "./fitLiveMapMarkers.ts";

export const INITIAL_MAP_CAMERA = {
  centerCoordinate: [0, 0] as [number, number],
  zoomLevel: 1.25,
};

export const mapCameraFromRegionChange = ({
  latitude,
  longitude,
  zoomLevel,
}: {
  latitude: number;
  longitude: number;
  zoomLevel: number;
}) => ({
  centerCoordinate: [longitude, latitude] as [number, number],
  zoomLevel,
});

export const mapCameraAfterFittingMarkers = ({
  markers,
  previousCamera,
}: {
  markers: readonly {
    latitude: number;
    longitude: number;
  }[];
  previousCamera: {
    centerCoordinate: [number, number];
    zoomLevel: number;
  };
}) => {
  const [firstMarker, ...rest] = markers;
  if (!firstMarker) {
    return previousCamera;
  }

  if (rest.length === 0) {
    return mapCameraFromRegionChange({
      latitude: firstMarker.latitude,
      longitude: firstMarker.longitude,
      zoomLevel: 14,
    });
  }

  const [longitude, latitude] = liveMapMarkersCenter(markers);
  return mapCameraFromRegionChange({
    latitude,
    longitude,
    zoomLevel: previousCamera.zoomLevel,
  });
};
