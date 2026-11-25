import type { DriveRecord, DrivingEvent } from "@openbeacon/encryption";
import { drivingEventName, drivingScore } from "./drivingScore.ts";
import {
  describeSpeedLimit,
  type DistanceUnit,
  formatDistance,
  formatSpeed,
  type SpeedUnit,
} from "./units.ts";

export const driveTitle = (startName: string | null, endName: string | null) => {
  if (startName && endName) return `${startName} → ${endName}`;
  if (startName) return `From ${startName}`;
  if (endName) return `To ${endName}`;
  return "Drive";
};

export const formatDriveDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export const driveFigures = (
  record: DriveRecord,
  units: { distance: DistanceUnit; speed: SpeedUnit },
) =>
  `${formatDistance(record.distance, units.distance)} · ${formatDriveDuration(record.duration)} · top ${formatSpeed(record.topSpeed, units.speed)}`;

export const drivingScoreReason = (
  record: DriveRecord,
  distanceUnit: DistanceUnit,
): string | null => {
  const score = drivingScore(record);
  if (!score) return null;
  const count = score.costs.reduce((total, cost) => total + cost.count, 0);
  const distance = formatDistance(record.checkedDistance, distanceUnit);
  const [most] = score.costs;
  if (count === 0 || !most) return `No possible Driving events in ${distance}.`;
  const events = count === 1 ? "1 possible Driving event" : `${count} possible Driving events`;
  const name = drivingEventName(most.type);
  return score.costs.length === 1
    ? `${events} in ${distance}.`
    : `${events} in ${distance}. ${name[0]?.toUpperCase()}${name.slice(1)} counted most.`;
};

export const drivingEventLines = (event: DrivingEvent, speedUnit: SpeedUnit) => {
  const duration = formatDriveDuration(event.duration);
  switch (event.type) {
    case "SPEEDING":
      return {
        title: `Speeding · ${formatSpeed(event.peak, speedUnit)} for ${duration}`,
        detail: event.limit ? describeSpeedLimit(event.limit, speedUnit) : null,
      };
    case "PHONE_USE":
      return {
        title: `Phone use · ${duration}`,
        detail: `while moving at ${formatSpeed(event.peak, speedUnit)}`,
      };
    case "HARD_BRAKING":
    case "RAPID_ACCELERATION":
      return {
        title: `${event.type === "HARD_BRAKING" ? "Hard braking" : "Rapid acceleration"} · ${formatSpeed(event.peak, speedUnit)} a second for ${duration}`,
        detail: null,
      };
  }
};
