import { describe, expect, test } from "bun:test";
import { timelineLaneRuns, timelineRoute, timelineRouteGradient } from "./timelineMap.ts";
import type { TimelinePosition, TimelineSegment } from "./timelineTypes.ts";

const at = (latitude: number, longitude = 0): TimelinePosition => ({
  accuracy: 5,
  latitude,
  longitude,
});

const moving = (start: number, from: TimelinePosition, to: TimelinePosition): TimelineSegment => ({
  kind: "moving",
  start,
  end: start + 1,
  from,
  to,
});

describe("timelineRoute", () => {
  test("joins moves through a stay and breaks the line at a gap", () => {
    const route = timelineRoute([
      moving(0, at(0), at(0.01)),
      { kind: "stay", start: 1, end: 2, position: at(0.01) },
      moving(2, at(0.01), at(0.02)),
      { kind: "noLocation", start: 3, end: 4 },
      moving(4, at(0.05), at(0.06)),
    ]);
    expect(route.runs).toEqual([
      [
        [0, 0],
        [0, 0.01],
        [0, 0.02],
      ],
      [
        [0, 0.05],
        [0, 0.06],
      ],
    ]);
    expect(route.line).toHaveLength(5);
    expect(route.gaps).toHaveLength(1);
    const [gap] = route.gaps;
    expect(gap?.from).toBeCloseTo(2 / 6, 3);
    expect(gap?.to).toBeCloseTo(5 / 6, 3);
  });

  test("draws a pause only when its ends are apart", () => {
    const route = timelineRoute([
      { kind: "pause", start: 0, end: 1, from: at(0), to: at(0.0001) },
      { kind: "pause", start: 1, end: 2, from: at(0), to: at(0.01) },
    ]);
    expect(route.pauses).toEqual([
      [
        [0, 0],
        [0, 0.01],
      ],
    ]);
    expect(route.line).toEqual([]);
  });

  test("leaves out a run that never moves", () => {
    const route = timelineRoute([
      { kind: "stay", start: 0, end: 5, position: at(1) },
      { kind: "noLocation", start: 5, end: 6 },
    ]);
    expect(route).toEqual({ gaps: [], line: [], pauses: [], runs: [] });
  });
});

describe("timelineRouteGradient", () => {
  const color = "#FF1464";

  test("fades from earlier to later across the whole line", () => {
    expect(timelineRouteGradient({ color, drawn: 1, gaps: [] })).toEqual([
      0,
      "rgba(255, 20, 100, 0.35)",
      1,
      "rgba(255, 20, 100, 1)",
    ]);
  });

  test("hides gaps and anything past the drawn part", () => {
    const stops = timelineRouteGradient({ color, drawn: 0.8, gaps: [{ from: 0.2, to: 0.5 }] });
    const progress = stops.filter((stop): stop is number => typeof stop === "number");
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(new Set(progress).size).toBe(progress.length);
    const colorAt = (value: number) => stops[stops.indexOf(value) + 1];
    expect(colorAt(0.2)).toBe("rgba(255, 20, 100, 0.48)");
    expect(colorAt(0.5)).toBe("rgba(255, 20, 100, 0.68)");
    expect(colorAt(0.8)).toBe("rgba(255, 20, 100, 0.87)");
    expect(stops.at(-2)).toBe(1);
    expect(stops.at(-1)).toBe("rgba(255, 20, 100, 0)");
    const hidden = progress.filter((value) => value > 0.2 && value < 0.5);
    expect(hidden.every((value) => colorAt(value) === "rgba(255, 20, 100, 0)")).toBe(true);
  });

  test("is fully clear before it starts drawing", () => {
    expect(timelineRouteGradient({ color, drawn: 0, gaps: [] })).toEqual([
      0,
      "rgba(255, 20, 100, 0)",
      1,
      "rgba(255, 20, 100, 0)",
    ]);
  });

  test("ignores a gap with no length", () => {
    expect(timelineRouteGradient({ color, drawn: 1, gaps: [{ from: 0.5, to: 0.5 }] })).toEqual([
      0,
      "rgba(255, 20, 100, 0.35)",
      1,
      "rgba(255, 20, 100, 1)",
    ]);
  });
});

describe("timelineLaneRuns", () => {
  test("merges touching segments of the same kind", () => {
    expect(
      timelineLaneRuns([
        moving(0, at(0), at(1)),
        moving(1, at(1), at(2)),
        { kind: "stay", start: 2, end: 5, position: at(2) },
        { kind: "noLocation", start: 5, end: 9 },
      ]),
    ).toEqual([
      { kind: "moving", start: 0, end: 2 },
      { kind: "stay", start: 2, end: 5 },
      { kind: "noLocation", start: 5, end: 9 },
    ]);
  });
});
