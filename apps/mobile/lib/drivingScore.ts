import {
  type DriveRecord,
  DRIVING_EVENT_TYPES,
  type DrivingEvent,
  type DrivingEventType,
} from "@openbeacon/encryption";

const SCORE_DISTANCE_METERS = 10_000;

const POINTS: Record<DrivingEventType, { least: number; of: (event: DrivingEvent) => number }> = {
  PHONE_USE: {
    least: 6,
    of: (event) => 6 + Math.min(event.duration, 120) / 20,
  },
  SPEEDING: {
    least: 3,
    of: (event) => {
      const over = event.limit && event.limit.speed > 0 ? event.peak / event.limit.speed - 1 : 0;
      return 3 + Math.min(Math.max(over, 0), 0.5) * 8 + Math.min(event.duration, 120) / 40;
    },
  },
  HARD_BRAKING: {
    least: 2,
    of: (event) => 2 + Math.min(Math.max(event.peak - 3.1, 0), 3),
  },
  RAPID_ACCELERATION: {
    least: 1,
    of: (event) => 1 + Math.min(Math.max(event.peak - 3.1, 0), 3) / 2,
  },
};

const NAMES: Record<DrivingEventType, string> = {
  PHONE_USE: "phone use",
  SPEEDING: "speeding",
  HARD_BRAKING: "hard braking",
  RAPID_ACCELERATION: "rapid acceleration",
};

export type DrivingScoreCost = {
  count: number;
  points: number;
  type: DrivingEventType;
};

export const drivingScore = (record: DriveRecord) => {
  if (record.passenger) return null;
  const scale = SCORE_DISTANCE_METERS / Math.max(record.checkedDistance, SCORE_DISTANCE_METERS);
  const costs = DRIVING_EVENT_TYPES.flatMap((type) => {
    if (type === "SPEEDING" && !record.speedLimitsChecked) return [];
    const kept = record.events.filter((event) => event.type === type).map(POINTS[type].of);
    const count = Math.max(record.counts[type], kept.length);
    if (count === 0) return [];
    const leastKept = kept.length > 0 ? Math.min(...kept) : POINTS[type].least;
    const unpositioned = (count - kept.length) * leastKept;
    const total = kept.reduce((sum, points) => sum + points, unpositioned);
    return [{ count, exact: total * scale, type }];
  })
    .sort((first, second) => second.exact - first.exact)
    .map(({ count, exact, type }): DrivingScoreCost => ({
      count,
      points: Math.round(exact),
      type,
    }))
    .filter((cost) => cost.points > 0);
  const lost = costs.reduce((sum, cost) => sum + cost.points, 0);
  return {
    costs,
    score: Math.max(0, 100 - lost),
    speedingChecked: record.speedLimitsChecked,
    uncheckedDistance: Math.max(0, record.distance - record.checkedDistance),
  };
};

export const drivingEventName = (type: DrivingEventType) => NAMES[type];

export const drivingScoreCostLabel = ({ count, points, type }: DrivingScoreCost) =>
  `−${points} ${NAMES[type]} (${count})`;
