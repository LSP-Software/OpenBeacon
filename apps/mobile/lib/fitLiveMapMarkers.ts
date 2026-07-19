import type { CameraRef } from "@maplibre/maplibre-react-native";
import type { LiveMapMarker } from "./buildLiveMapMarkers.ts";

const ANIMATION_DURATION_MS = 600;
const MIN_FIT_SPAN_DEGREES = 0.02;

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
  if (!camera) {
    return null;
  }

  const validMarkers = markers.filter(hasValidCoordinate);
  const [firstMarker, ...rest] = validMarkers;
  if (!firstMarker) {
    return null;
  }

  const paddingConfig = [
    padding.paddingTop,
    padding.paddingRight,
    padding.paddingBottom,
    padding.paddingLeft,
  ];

  if (rest.length === 0) {
    camera.setCamera({
      animationDuration: ANIMATION_DURATION_MS,
      centerCoordinate: [firstMarker.longitude, firstMarker.latitude],
      padding,
      zoomLevel: 14,
    });
    return ANIMATION_DURATION_MS;
  }

  const bounds = computeLiveMapFitBounds(validMarkers);
  camera.fitBounds(bounds.ne, bounds.sw, paddingConfig, ANIMATION_DURATION_MS);
  return ANIMATION_DURATION_MS;
};

const hasValidCoordinate = (marker: LiveMapMarker) =>
  Number.isFinite(marker.latitude) &&
  Number.isFinite(marker.longitude) &&
  marker.latitude >= -90 &&
  marker.latitude <= 90 &&
  marker.longitude >= -180 &&
  marker.longitude <= 180;

const computeLiveMapFitBounds = (markers: readonly LiveMapMarker[]) => {
  const latitudes = markers.map((marker) => marker.latitude);
  let north = Math.max(...latitudes);
  let south = Math.min(...latitudes);

  const longitudes = markers.map((marker) => normalizeLongitude(marker.longitude));
  let { west, east } = shortestLongitudeBounds(longitudes);

  const latSpan = north - south;
  if (latSpan < MIN_FIT_SPAN_DEGREES) {
    const center = (north + south) / 2;
    south = Math.max(-90, center - MIN_FIT_SPAN_DEGREES / 2);
    north = Math.min(90, south + MIN_FIT_SPAN_DEGREES);
    south = Math.max(-90, north - MIN_FIT_SPAN_DEGREES);
  }

  if (longitudeSpan(west, east) < MIN_FIT_SPAN_DEGREES) {
    const center = normalizeLongitude(west + longitudeSpan(west, east) / 2);
    west = normalizeLongitude(center - MIN_FIT_SPAN_DEGREES / 2);
    east = normalizeLongitude(west + MIN_FIT_SPAN_DEGREES);
  }

  return {
    ne: [east, north] as [number, number],
    sw: [west, south] as [number, number],
  };
};

const shortestLongitudeBounds = (longitudes: readonly number[]) => {
  const sorted = [...new Set(longitudes)].sort((left, right) => left - right);
  if (sorted.length === 1) {
    return { east: sorted[0]!, west: sorted[0]! };
  }

  let largestGap = Number.NEGATIVE_INFINITY;
  let indexBeforeLargestGap = 0;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const gap = sorted[index + 1]! - sorted[index]!;
    if (gap > largestGap) {
      largestGap = gap;
      indexBeforeLargestGap = index;
    }
  }

  const wrapGap = sorted[0]! + 360 - sorted[sorted.length - 1]!;
  if (wrapGap > largestGap) {
    return { east: sorted[sorted.length - 1]!, west: sorted[0]! };
  }

  return {
    east: sorted[indexBeforeLargestGap]!,
    west: sorted[indexBeforeLargestGap + 1]!,
  };
};

const longitudeSpan = (west: number, east: number) =>
  east >= west ? east - west : east + 360 - west;

const normalizeLongitude = (longitude: number) => {
  if (longitude > -180 && longitude <= 180) {
    return longitude;
  }
  if (longitude === -180) {
    return 180;
  }
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
};
