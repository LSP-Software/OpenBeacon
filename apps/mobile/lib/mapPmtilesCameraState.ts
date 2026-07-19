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
