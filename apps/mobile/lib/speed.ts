export type SpeedUnit = "mph" | "kmh";

const MOVING_SPEED_MPS = 1;
const MAX_SHOWN_SPEED_MPS = 90;
const LIVE_SPEED_MAX_AGE_MS = 3 * 60_000;

const MPH_REGIONS = new Set([
  "AG",
  "AI",
  "AS",
  "BS",
  "BZ",
  "DM",
  "FK",
  "GB",
  "GD",
  "GG",
  "GU",
  "IM",
  "JE",
  "KN",
  "KY",
  "LC",
  "LR",
  "MP",
  "MS",
  "PR",
  "SH",
  "TC",
  "UM",
  "US",
  "VC",
  "VG",
  "VI",
  "WS",
]);

export const defaultSpeedUnit = ({
  measurementSystem,
  regionCode,
}: {
  measurementSystem: string | null;
  regionCode: string | null;
}): SpeedUnit => {
  if (regionCode) return MPH_REGIONS.has(regionCode.toUpperCase()) ? "mph" : "kmh";
  return measurementSystem === "us" || measurementSystem === "uk" ? "mph" : "kmh";
};

export const speedUnitName = (unit: SpeedUnit) =>
  unit === "mph" ? "Miles per hour (mph)" : "Kilometres per hour (km/h)";

export const formatSpeed = (metersPerSecond: number, unit: SpeedUnit) =>
  unit === "mph"
    ? `${Math.round(metersPerSecond * 2.2369362920544)} mph`
    : `${Math.round(metersPerSecond * 3.6)} km/h`;

export const movingSpeedLabel = (speed: number | null, unit: SpeedUnit) =>
  speed !== null && speed >= MOVING_SPEED_MPS && speed <= MAX_SHOWN_SPEED_MPS
    ? formatSpeed(speed, unit)
    : null;

export const liveSpeedLabel = ({
  now,
  speed,
  timestamp,
  unit,
}: {
  now: number;
  speed: number | null;
  timestamp: string | null;
  unit: SpeedUnit;
}) => {
  if (timestamp === null) return null;
  const age = now - Date.parse(timestamp);
  if (!(age >= -60_000 && age <= LIVE_SPEED_MAX_AGE_MS)) return null;
  return movingSpeedLabel(speed, unit);
};

export const liveSpeedHidesAt = (timestamp: string) =>
  Date.parse(timestamp) + LIVE_SPEED_MAX_AGE_MS + 1;
