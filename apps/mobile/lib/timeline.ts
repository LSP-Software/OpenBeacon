import type { PlaceGeometryV1 } from "@openbeacon/encryption";
import { senderHistoryStart } from "./historyShare.ts";
import { metersBetween } from "./places.ts";
import type {
  TimelineDay,
  TimelineDeviceData,
  TimelinePoint,
  TimelinePosition,
  TimelineSegment,
  TimelineSender,
} from "./timelineTypes.ts";

export const SAME_STOP_METERS = 100;
const NO_LOCATION_AFTER_MS = 10 * 60_000;

const positionOf = ({ accuracy, latitude, longitude }: TimelinePoint): TimelinePosition => ({
  accuracy,
  latitude,
  longitude,
});

const deviceSegments = (unsorted: readonly TimelinePoint[]) => {
  const points = [...unsorted].sort((a, b) => a.time - b.time);
  const segments: TimelineSegment[] = [];
  points.forEach((point, index) => {
    const next = points[index + 1];
    const coveredUntil = Math.max(
      point.time,
      Math.min(point.stayUntil ?? point.time, next?.time ?? Infinity),
    );
    if (coveredUntil > point.time) {
      segments.push({
        kind: "stay",
        start: point.time,
        end: coveredUntil,
        position: positionOf(point),
      });
    }
    if (!next || next.time <= coveredUntil) return;
    const gap = {
      start: coveredUntil,
      end: next.time,
      from: positionOf(point),
      to: positionOf(next),
    };
    if (next.revisionPrefix !== point.revisionPrefix) {
      segments.push({ kind: "pause", ...gap });
    } else if (next.time - coveredUntil > NO_LOCATION_AFTER_MS) {
      segments.push({ kind: "noLocation", start: gap.start, end: gap.end });
    } else {
      segments.push({ kind: "moving", ...gap });
    }
  });
  return segments;
};

const interpolate = (
  segment: { start: number; end: number; from: TimelinePosition; to: TimelinePosition },
  time: number,
): TimelinePosition => {
  const fraction = (time - segment.start) / (segment.end - segment.start);
  const { from, to } = segment;
  return {
    accuracy:
      from.accuracy === null || to.accuracy === null
        ? null
        : from.accuracy + (to.accuracy - from.accuracy) * fraction,
    latitude: from.latitude + (to.latitude - from.latitude) * fraction,
    longitude: from.longitude + (to.longitude - from.longitude) * fraction,
  };
};

const clipSegments = (segments: readonly TimelineSegment[], from: number, to: number) => {
  const clipped: TimelineSegment[] = [];
  for (const segment of segments) {
    const start = Math.max(segment.start, from);
    const end = Math.min(segment.end, to);
    if (end <= start) continue;
    clipped.push(
      segment.kind === "moving"
        ? {
            ...segment,
            start,
            end,
            from: interpolate(segment, start),
            to: interpolate(segment, end),
          }
        : { ...segment, start, end },
    );
  }
  const first = clipped[0];
  const last = clipped.at(-1);
  if (!first || !last)
    return from < to ? [{ kind: "noLocation" as const, start: from, end: to }] : [];
  return [
    ...(first.start - from > NO_LOCATION_AFTER_MS
      ? [{ kind: "noLocation" as const, start: from, end: first.start }]
      : []),
    ...clipped,
    ...(last.end < to ? [{ kind: "noLocation" as const, start: last.end, end: to }] : []),
  ];
};

export const buildTimeline = ({
  day,
  devices,
  joinStart,
  now,
  senders = [],
  windowStart,
}: {
  day: TimelineDay;
  devices: readonly TimelineDeviceData[];
  joinStart: number | null;
  now: number;
  senders?: readonly TimelineSender[];
  windowStart: number;
}) => {
  const historyStart = Math.max(windowStart, joinStart ?? windowStart);
  const from = Math.max(day.start, historyStart);
  const to = Math.min(day.end, now);
  return {
    day,
    from,
    historyStart,
    to,
    devices: devices.map(({ deviceId, points, undecryptable, userId }) => {
      const personStart = Math.max(historyStart, senderHistoryStart(senders, userId) ?? 0);
      const personFrom = Math.max(from, personStart);
      return {
        deviceId,
        historyStart: personStart,
        pointCount: points.filter((point) => point.time >= day.start && point.time < day.end)
          .length,
        segments: personFrom < to ? clipSegments(deviceSegments(points), personFrom, to) : [],
        undecryptable,
        userId,
      };
    }),
  };
};

export const pickPersonDevices = <
  Device extends { deviceId: string; pointCount: number; userId: string },
>(
  devices: readonly Device[],
  userId: string,
) => {
  const [selected, ...others] = devices
    .filter((device) => device.userId === userId)
    .sort((a, b) => b.pointCount - a.pointCount || a.deviceId.localeCompare(b.deviceId));
  return selected ? { others, selected } : null;
};

export const timelinePositionAt = (
  segments: readonly TimelineSegment[],
  time: number,
):
  | { position: TimelinePosition; state: "moving" | "pause" | "stay" }
  | { position: null; state: "noLocation" } => {
  let low = 0;
  let high = segments.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((segments[middle]?.start ?? Infinity) <= time) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const found = segments[index];
  if (!found || time > found.end) return { position: null, state: "noLocation" };
  const previous = segments[index - 1];
  const segment =
    (found.kind === "noLocation" || found.kind === "pause") &&
    time === found.start &&
    previous?.end === time &&
    (previous.kind === "moving" || previous.kind === "stay")
      ? previous
      : found;

  switch (segment.kind) {
    case "moving":
      return { position: interpolate(segment, time), state: "moving" };
    case "stay":
      return { position: segment.position, state: "stay" };
    case "pause":
      return { position: segment.from, state: "pause" };
    case "noLocation":
      return { position: null, state: "noLocation" };
  }
};

export const timelineDayStats = ({
  places,
  segments,
}: {
  places: ReadonlyArray<{ geometry: PlaceGeometryV1 | null; id: string }>;
  segments: readonly TimelineSegment[];
}) => {
  let distanceMeters = 0;
  let movingMs = 0;
  let joinsLastStop = false;
  const stops: Array<{
    end: number;
    placeId: string | null;
    position: TimelinePosition;
    start: number;
  }> = [];
  for (const segment of segments) {
    if (segment.kind === "moving") {
      distanceMeters += metersBetween(segment.from, segment.to);
      movingMs += segment.end - segment.start;
      continue;
    }
    if (segment.kind !== "stay") {
      joinsLastStop = false;
      continue;
    }
    const lastStop = stops.at(-1);
    if (
      joinsLastStop &&
      lastStop &&
      metersBetween(lastStop.position, segment.position) <= SAME_STOP_METERS
    ) {
      lastStop.end = segment.end;
      continue;
    }
    joinsLastStop = true;
    let placeId: string | null = null;
    let nearest = Infinity;
    for (const { geometry, id } of places) {
      if (!geometry) continue;
      const meters = metersBetween(geometry, segment.position);
      if (meters <= geometry.radiusMeters && meters < nearest) {
        nearest = meters;
        placeId = id;
      }
    }
    stops.push({ end: segment.end, placeId, position: segment.position, start: segment.start });
  }
  return { distanceMeters, movingMs, stops };
};
