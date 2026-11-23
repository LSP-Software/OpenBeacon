import type { TimelineSegment } from "./timelineTypes.ts";

export type TimelineTrack = {
  end: Float64Array;
  fromLatitude: Float64Array;
  fromLongitude: Float64Array;
  kind: Int8Array;
  start: Float64Array;
  status: Int32Array;
  toLatitude: Float64Array;
  toLongitude: Float64Array;
};

const KIND_CODE = { moving: 0, stay: 1, noLocation: 2, pause: 3 } as const;
const MOVING = KIND_CODE.moving;
const STAY = KIND_CODE.stay;
const NO_LOCATION = KIND_CODE.noLocation;
const PAUSE = KIND_CODE.pause;

export const packTimelineTrack = (segments: readonly TimelineSegment[]): TimelineTrack => {
  const count = segments.length;
  const track: TimelineTrack = {
    end: new Float64Array(count),
    fromLatitude: new Float64Array(count),
    fromLongitude: new Float64Array(count),
    kind: new Int8Array(count),
    start: new Float64Array(count),
    status: new Int32Array(count),
    toLatitude: new Float64Array(count),
    toLongitude: new Float64Array(count),
  };
  segments.forEach((segment, index) => {
    track.start[index] = segment.start;
    track.end[index] = segment.end;
    track.kind[index] = KIND_CODE[segment.kind];
    const previous = segments[index - 1];
    track.status[index] =
      segment.kind === "moving" && previous?.kind === "moving" && previous.end === segment.start
        ? (track.status[index - 1] ?? index)
        : index;
    const [from, to] =
      segment.kind === "stay"
        ? [segment.position, segment.position]
        : segment.kind === "noLocation"
          ? [null, null]
          : [segment.from, segment.to];
    track.fromLatitude[index] = from?.latitude ?? Number.NaN;
    track.fromLongitude[index] = from?.longitude ?? Number.NaN;
    track.toLatitude[index] = to?.latitude ?? Number.NaN;
    track.toLongitude[index] = to?.longitude ?? Number.NaN;
  });
  return track;
};

export const timelineTrackSegmentAt = (track: TimelineTrack, time: number) => {
  "worklet";
  let low = 0;
  let high = track.start.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((track.start[middle] ?? Infinity) <= time) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (index === -1 || time > (track.end[index] ?? -Infinity)) return -1;
  const kind = track.kind[index];
  const previousKind = track.kind[index - 1];
  const leaningBack =
    kind !== MOVING &&
    kind !== STAY &&
    time === track.start[index] &&
    track.end[index - 1] === time &&
    (previousKind === MOVING || previousKind === STAY);
  const used = leaningBack ? index - 1 : index;
  return track.kind[used] === NO_LOCATION ? -1 : used;
};

export const timelineTrackCoordinateAt = (
  track: TimelineTrack,
  index: number,
  time: number,
): [longitude: number, latitude: number] => {
  "worklet";
  const fromLatitude = track.fromLatitude[index] ?? Number.NaN;
  const fromLongitude = track.fromLongitude[index] ?? Number.NaN;
  if (track.kind[index] !== MOVING) return [fromLongitude, fromLatitude];
  const start = track.start[index] ?? 0;
  const fraction = (time - start) / ((track.end[index] ?? start) - start);
  return [
    fromLongitude + ((track.toLongitude[index] ?? fromLongitude) - fromLongitude) * fraction,
    fromLatitude + ((track.toLatitude[index] ?? fromLatitude) - fromLatitude) * fraction,
  ];
};

export const timelineTrackStateKey = (
  tracks: readonly TimelineTrack[],
  selected: TimelineTrack | null,
  time: number,
) => {
  "worklet";
  let key = "";
  for (const track of tracks) {
    const index = timelineTrackSegmentAt(track, time);
    key += index === -1 ? "n" : track.kind[index] === PAUSE ? "p" : "v";
  }
  if (!selected) return key;
  const index = timelineTrackSegmentAt(selected, time);
  return `${key}|${index === -1 ? -1 : selected.status[index]}`;
};

export const timelineMinuteLabels = (
  day: { end: number; start: number },
  format: (time: number) => string,
) =>
  Array.from({ length: Math.ceil((day.end - day.start) / 60_000) }, (_, minute) =>
    format(day.start + minute * 60_000),
  );

export const timelineMinuteLabelAt = (
  labels: readonly string[],
  endLabel: string,
  day: { end: number; start: number },
  time: number,
) => {
  "worklet";
  if (time >= day.end) return endLabel;
  const minute = Math.min(Math.max(Math.floor((time - day.start) / 60_000), 0), labels.length - 1);
  return labels[minute] ?? endLabel;
};
