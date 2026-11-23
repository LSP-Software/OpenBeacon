import { metersBetween } from "./places.ts";
import { SAME_STOP_METERS } from "./timeline.ts";
import type { Coordinate, TimelineSegment } from "./timelineTypes.ts";

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

type Point = { x: number; y: number };

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
  let previous: Point | null = null;
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
  alpha = { from: 0.35, to: 1 },
  color,
  drawn,
  gaps,
}: {
  alpha?: { from: number; to: number };
  color: string;
  drawn: number;
  gaps: ReadonlyArray<{ from: number; to: number }>;
}) => {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const colorAt = (progress: number) =>
    `rgba(${red}, ${green}, ${blue}, ${Math.round((alpha.from + (alpha.to - alpha.from) * progress) * 100) / 100})`;
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

const MAX_ARROWS = 600;

type ArrowViewport = {
  bounds: [west: number, south: number, east: number, north: number];
  zoom: number;
};

export const timelineArrowViewport = (current: ArrowViewport | null, next: ArrowViewport) => {
  if (!current || Math.round(current.zoom * 4) !== Math.round(next.zoom * 4)) return next;
  const [west, south, east, north] = current.bounds;
  const topLeft = projected([west, north]);
  const bottomRight = projected([east, south]);
  const padX = (bottomRight.x - topLeft.x) / 2;
  const padY = (bottomRight.y - topLeft.y) / 2;
  const nextTopLeft = projected([next.bounds[0], next.bounds[3]]);
  const nextBottomRight = projected([next.bounds[2], next.bounds[1]]);
  const inside =
    nextTopLeft.x >= topLeft.x - padX &&
    nextBottomRight.x <= bottomRight.x + padX &&
    nextTopLeft.y >= topLeft.y - padY &&
    nextBottomRight.y <= bottomRight.y + padY;
  return inside ? current : next;
};

export const timelineArrows = ({
  runs,
  sizePx,
  spacingPx,
  viewport,
}: {
  runs: ReadonlyArray<readonly Coordinate[]>;
  sizePx: number;
  spacingPx: number;
  viewport: ArrowViewport;
}) => {
  const worldSize = 512 * 2 ** viewport.zoom;
  const toPixel = (coordinate: Coordinate) => {
    const point = projected(coordinate);
    return { x: point.x * worldSize, y: point.y * worldSize };
  };
  const toCoordinate = ({ x, y }: Point): Coordinate => [
    (x / worldSize - 0.5) * 360,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldSize))) * 180) / Math.PI,
  ];

  const [west, south, east, north] = viewport.bounds;
  const topLeft = toPixel([west, north]);
  const bottomRight = toPixel([east, south]);
  const padX = (bottomRight.x - topLeft.x) / 2;
  const padY = (bottomRight.y - topLeft.y) / 2;
  const area = {
    left: topLeft.x - padX,
    right: bottomRight.x + padX,
    top: topLeft.y - padY,
    bottom: bottomRight.y + padY,
  };

  const marks: Array<{ direction: Point; heading: number; tip: Point; twoWay: boolean }> = [];
  let chevronCount = 0;
  const placed = new Map<string, typeof marks>();
  const place = (tip: Point, direction: Point) => {
    if (tip.x < area.left || tip.x > area.right || tip.y < area.top || tip.y > area.bottom) return;
    const heading = Math.atan2(direction.y, direction.x);
    const cellX = Math.floor(tip.x / spacingPx);
    const cellY = Math.floor(tip.y / spacingPx);
    let oncoming = false;
    let partner: { distance: number; mark: (typeof marks)[number] } | null = null;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of placed.get(`${cellX + dx}:${cellY + dy}`) ?? []) {
          const offsetX = tip.x - other.tip.x;
          const offsetY = tip.y - other.tip.y;
          const distance = Math.hypot(offsetX, offsetY);
          if (distance >= spacingPx * 0.75) continue;
          const alignment = Math.cos(other.heading - heading);
          if (alignment > Math.SQRT1_2) return;
          const sideways = Math.abs(offsetX * other.direction.y - offsetY * other.direction.x);
          if (alignment > -0.9 || sideways >= sizePx * 2) continue;
          oncoming = true;
          if (!other.twoWay && (!partner || distance < partner.distance)) {
            partner = { distance, mark: other };
          }
        }
      }
    }
    if (partner) {
      partner.mark.twoWay = true;
      chevronCount += 1;
    }
    if (oncoming) return;
    const mark = { direction, heading, tip, twoWay: false };
    marks.push(mark);
    chevronCount += 1;
    const cell = `${cellX}:${cellY}`;
    placed.set(cell, [...(placed.get(cell) ?? []), mark]);
  };
  const chevron = (tip: Point, direction: Point) => {
    const arm = (angle: number) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return toCoordinate({
        x: tip.x - sizePx * (direction.x * cos - direction.y * sin),
        y: tip.y - sizePx * (direction.x * sin + direction.y * cos),
      });
    };
    return [arm((40 * Math.PI) / 180), toCoordinate(tip), arm((-40 * Math.PI) / 180)];
  };
  const toChevrons = () =>
    marks.flatMap(({ direction, tip, twoWay }) => {
      if (!twoWay) return [chevron(tip, direction)];
      const gap = sizePx * 1.4;
      return [
        chevron({ x: tip.x + direction.x * gap, y: tip.y + direction.y * gap }, direction),
        chevron(
          { x: tip.x - direction.x * gap, y: tip.y - direction.y * gap },
          { x: -direction.x, y: -direction.y },
        ),
      ];
    });

  for (const run of runs) {
    const points = run.map(toPixel);
    const legs = points.slice(1).map((to, index) => {
      const from = points[index] ?? to;
      return { from, to, length: Math.hypot(to.x - from.x, to.y - from.y) };
    });
    const length = legs.reduce((total, leg) => total + leg.length, 0);
    if (length < 1.5 * sizePx) continue;

    let next = length < spacingPx ? length / 2 : spacingPx / 2;
    let travelled = 0;
    for (const leg of legs) {
      if (chevronCount >= MAX_ARROWS) return toChevrons();
      const legEnd = travelled + leg.length;
      if (leg.length === 0 || next >= legEnd) {
        travelled = legEnd;
        continue;
      }
      const onScreen =
        Math.max(leg.from.x, leg.to.x) >= area.left &&
        Math.min(leg.from.x, leg.to.x) <= area.right &&
        Math.max(leg.from.y, leg.to.y) >= area.top &&
        Math.min(leg.from.y, leg.to.y) <= area.bottom;
      if (!onScreen) {
        next += Math.ceil((legEnd - next) / spacingPx) * spacingPx;
        travelled = legEnd;
        continue;
      }
      const direction = {
        x: (leg.to.x - leg.from.x) / leg.length,
        y: (leg.to.y - leg.from.y) / leg.length,
      };
      for (; next < legEnd && chevronCount < MAX_ARROWS; next += spacingPx) {
        const along = next - travelled;
        place(
          { x: leg.from.x + direction.x * along, y: leg.from.y + direction.y * along },
          direction,
        );
      }
      travelled = legEnd;
    }
  }
  return toChevrons();
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

export const timelineFitKeys = ({
  dayKey,
  loaded,
  personId,
  ready,
  routeIds,
  shownUserIds,
}: {
  dayKey: string;
  loaded: boolean;
  personId: string | null;
  ready: boolean;
  routeIds: readonly string[];
  shownUserIds: readonly string[];
}) => {
  const view = JSON.stringify([dayKey, personId, personId ? routeIds : shownUserIds, ready]);
  return { key: JSON.stringify([view, routeIds.length > 0, loaded]), view };
};
