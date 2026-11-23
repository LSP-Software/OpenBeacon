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

export const parseSpeedPreference = (stored: string | undefined): SpeedUnit | "auto" =>
  stored === "mph" || stored === "kmh" ? stored : "auto";

export const speedUnitName = (unit: SpeedUnit) =>
  unit === "mph" ? "Miles per hour (mph)" : "Kilometres per hour (km/h)";

export const formatSpeed = (metersPerSecond: number, unit: SpeedUnit) =>
  unit === "mph"
    ? `${Math.round(metersPerSecond * 2.2369362920544)} mph`
    : `${Math.round(metersPerSecond * 3.6)} km/h`;

export const formatDistance = (meters: number, unit: SpeedUnit) => {
  const metres = Math.round(meters);
  const feet = Math.round(meters * 3.28084);
  if (unit === "kmh" && metres < 1000) return `${metres} m`;
  if (unit === "mph" && feet < 528) return `${feet} ft`;
  const value = unit === "kmh" ? meters / 1000 : meters / 1609.344;
  return `${value < 99.95 ? value.toFixed(1) : Math.round(value)} ${unit === "kmh" ? "km" : "mi"}`;
};

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

export const timelineSpeedLabel = (
  pin: { position: { speed: number | null }; state: "moving" | "pause" | "stay" } | null,
  unit: SpeedUnit,
) => (pin?.state === "moving" ? movingSpeedLabel(pin.position.speed, unit) : null);
