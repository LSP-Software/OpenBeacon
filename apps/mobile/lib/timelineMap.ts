import { metersBetween } from "./places.ts";
import { SAME_STOP_METERS } from "./timeline.ts";
import type { TimelineSegment } from "./timelineTypes.ts";

type Coordinate = [longitude: number, latitude: number];

const coordinateOf = (position: { latitude: number; longitude: number }): Coordinate => [
  position.longitude,
  position.latitude,
];

const projected = ([longitude, latitude]: Coordinate) => {
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: longitude / 360 + 0.5,
    y: 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI,
  };
};

export const timelineRoute = (segments: readonly TimelineSegment[]) => {
  const runs: Coordinate[][] = [];
  const pauses: Array<[Coordinate, Coordinate]> = [];
  let run: Coordinate[] = [];
  const closeRun = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (const segment of segments) {
    if (segment.kind === "moving") {
      if (run.length === 0) run.push(coordinateOf(segment.from));
      run.push(coordinateOf(segment.to));
      continue;
    }
    if (segment.kind === "stay") continue;
    closeRun();
    if (segment.kind === "pause" && metersBetween(segment.from, segment.to) > SAME_STOP_METERS) {
      pauses.push([coordinateOf(segment.from), coordinateOf(segment.to)]);
    }
  }
  closeRun();

  const line = runs.flat();
  const runEnds: number[] = [];
  let distance = 0;
  let previous: { x: number; y: number } | null = null;
  const breaks: Array<{ from: number; to: number }> = [];
  for (const [index, current] of runs.entries()) {
    for (const [pointIndex, coordinate] of current.entries()) {
      const point = projected(coordinate);
      if (previous) distance += Math.hypot(point.x - previous.x, point.y - previous.y);
      if (pointIndex === 0 && index > 0) {
        breaks.push({ from: runEnds.at(-1) ?? 0, to: distance });
      }
      previous = point;
    }
    runEnds.push(distance);
  }
  const gaps =
    distance > 0 ? breaks.map((gap) => ({ from: gap.from / distance, to: gap.to / distance })) : [];

  return { gaps, line: distance > 0 ? line : [], pauses, runs };
};

const EDGE = 1e-6;

export const timelineRouteGradient = ({
  color,
  drawn,
  gaps,
}: {
  color: string;
  drawn: number;
  gaps: ReadonlyArray<{ from: number; to: number }>;
}) => {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const colorAt = (progress: number) =>
    `rgba(${red}, ${green}, ${blue}, ${Math.round((0.35 + 0.65 * progress) * 100) / 100})`;
  const clear = `rgba(${red}, ${green}, ${blue}, 0)`;

  const end = Math.min(Math.max(drawn, 0), 1);
  const visible: Array<{ from: number; to: number }> = [];
  let start = 0;
  for (const gap of gaps) {
    if (gap.from >= end) break;
    if (gap.to <= gap.from) continue;
    if (gap.from > start) visible.push({ from: start, to: gap.from });
    start = gap.to;
  }
  if (end > start) visible.push({ from: start, to: end });

  const stops: Array<[number, string]> = [];
  const add = (progress: number, stopColor: string) => {
    const last = stops.at(-1);
    if (progress < 0 || progress > 1 || (last && progress <= last[0])) return;
    stops.push([progress, stopColor]);
  };
  add(0, (visible[0]?.from ?? 1) > 0 ? clear : colorAt(0));
  for (const range of visible) {
    add(range.from - EDGE, clear);
    add(range.from, colorAt(range.from));
    add(range.to, colorAt(range.to));
    add(range.to + EDGE, clear);
  }
  add(1, clear);
  if (stops.length < 2) return [0, clear, 1, clear];
  return stops.flat();
};

export const timelineLaneRuns = (segments: readonly TimelineSegment[]) => {
  const runs: Array<{ end: number; kind: TimelineSegment["kind"]; start: number }> = [];
  for (const { end, kind, start } of segments) {
    const last = runs.at(-1);
    if (last && last.kind === kind && last.end === start) {
      last.end = end;
      continue;
    }
    runs.push({ end, kind, start });
  }
  return runs;
};
