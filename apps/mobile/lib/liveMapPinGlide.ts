const LATE_UPDATE_ALLOWANCE_MS = 2_000;
const LATE_ARRIVAL_ALLOWANCE_MS = 30_000;
const LONGEST_GLIDE_MS = 90_000;
const MAX_CONTINUOUS_GAP_MS = 180_000;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const METERS_PER_DEGREE = 111_320;
const SHORTEST_GLIDE_METERS = 5;

const wrapLongitude = (longitude: number) => {
  "worklet";
  return longitude >= 180 ? longitude - 360 : longitude < -180 ? longitude + 360 : longitude;
};

export type LiveMapPinGlide = {
  durationMs: number;
  fixTimeMs: number | null;
  fromLatitude: number;
  fromLongitude: number;
  latitude: number;
  longitude: number;
  startedAtMs: number;
};

export const liveMapPinGlidePosition = (glide: LiveMapPinGlide, nowMs: number) => {
  "worklet";
  const travelled =
    glide.durationMs === 0
      ? 1
      : Math.min(Math.max(0, nowMs - glide.startedAtMs) / glide.durationMs, 1);
  if (travelled === 1) {
    return {
      latitude: glide.latitude,
      longitude: glide.longitude,
      settled: true,
    };
  }
  return {
    latitude: glide.fromLatitude + (glide.latitude - glide.fromLatitude) * travelled,
    longitude: wrapLongitude(
      glide.fromLongitude + wrapLongitude(glide.longitude - glide.fromLongitude) * travelled,
    ),
    settled: false,
  };
};

export const restingLiveMapPinGlide = (
  fix: { latitude: number; longitude: number },
  nowMs: number,
): LiveMapPinGlide => ({
  durationMs: 0,
  fixTimeMs: null,
  fromLatitude: fix.latitude,
  fromLongitude: fix.longitude,
  latitude: fix.latitude,
  longitude: fix.longitude,
  startedAtMs: nowMs,
});

export const continueLiveMapPinGlide = (
  previous: LiveMapPinGlide | undefined,
  fix: { latitude: number; longitude: number; timestamp: string | null },
  nowMs: number,
): LiveMapPinGlide => {
  const parsedTime = fix.timestamp === null ? Number.NaN : Date.parse(fix.timestamp);
  const fixTimeMs = Number.isNaN(parsedTime) ? null : parsedTime;
  if (
    previous &&
    previous.latitude === fix.latitude &&
    previous.longitude === fix.longitude &&
    previous.fixTimeMs === fixTimeMs
  ) {
    return previous;
  }
  const gapMs =
    !previous || previous.fixTimeMs === null || fixTimeMs === null
      ? null
      : fixTimeMs - previous.fixTimeMs;
  if (
    !previous ||
    gapMs === null ||
    gapMs <= 0 ||
    gapMs > MAX_CONTINUOUS_GAP_MS ||
    nowMs - previous.startedAtMs > gapMs + LATE_ARRIVAL_ALLOWANCE_MS
  ) {
    return { ...restingLiveMapPinGlide(fix, nowMs), fixTimeMs };
  }
  const shown = liveMapPinGlidePosition(previous, nowMs);
  const metersToGo = Math.hypot(
    wrapLongitude(fix.longitude - shown.longitude) *
      METERS_PER_DEGREE *
      Math.cos((fix.latitude * Math.PI) / 180),
    (fix.latitude - shown.latitude) * METERS_PER_DEGREE,
  );
  if (metersToGo < SHORTEST_GLIDE_METERS) {
    return { ...restingLiveMapPinGlide(fix, nowMs), fixTimeMs };
  }
  return {
    durationMs: Math.min(gapMs + LATE_UPDATE_ALLOWANCE_MS, LONGEST_GLIDE_MS),
    fixTimeMs,
    fromLatitude: shown.latitude,
    fromLongitude: shown.longitude,
    latitude: fix.latitude,
    longitude: fix.longitude,
    startedAtMs: nowMs,
  };
};

export const liveMapPinGlideOffsetPosition = ({
  base,
  glides,
  nowMs,
}: {
  base: { latitude: number; longitude: number };
  glides: readonly LiveMapPinGlide[];
  nowMs: number;
}) => {
  "worklet";
  let latitude = 0;
  let longitude = 0;
  let settled = true;
  for (const glide of glides) {
    const shown = liveMapPinGlidePosition(glide, nowMs);
    latitude += shown.latitude - glide.latitude;
    longitude += wrapLongitude(shown.longitude - glide.longitude);
    settled &&= shown.settled;
  }
  const count = Math.max(glides.length, 1);
  return {
    latitude: base.latitude + latitude / count,
    longitude: wrapLongitude(base.longitude + longitude / count),
    settled,
  };
};

export const liveMapPinPixelsBetween = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  zoom: number,
) => {
  "worklet";
  const latitude = Math.min(Math.max(from.latitude, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE);
  return (
    (Math.hypot(
      wrapLongitude(to.longitude - from.longitude),
      (to.latitude - from.latitude) / Math.cos((latitude * Math.PI) / 180),
    ) *
      512 *
      2 ** zoom) /
    360
  );
};
