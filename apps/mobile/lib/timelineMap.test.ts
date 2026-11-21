import { describe, expect, test } from "bun:test";
import {
  timelineFitKeys,
  timelineArrowViewport,
  timelineArrows,
  timelineLaneRuns,
  timelineRoute,
  timelineRouteGradient,
} from "./timelineMap.ts";
import type { Coordinate, TimelinePosition, TimelineSegment } from "./timelineTypes.ts";

const at = (latitude: number, longitude = 0): TimelinePosition => ({
  accuracy: 5,
  latitude,
  longitude,
  speed: null,
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

  test("spreads a custom alpha range along the line", () => {
    expect(
      timelineRouteGradient({
        alpha: { from: 0.2, to: 0.4 },
        color: "#000000",
        drawn: 1,
        gaps: [],
      }),
    ).toEqual([0, "rgba(0, 0, 0, 0.2)", 1, "rgba(0, 0, 0, 0.4)"]);
  });
});

describe("timelineArrows", () => {
  const world: [number, number, number, number] = [-180, -80, 180, 80];
  const eastward: Coordinate[] = [
    [0, 0],
    [0.5, 0],
    [1, 0],
  ];
  const arrows = (runs: Coordinate[][], zoom: number, bounds = world) =>
    timelineArrows({ runs, sizePx: 5, spacingPx: 44, viewport: { bounds, zoom } });

  test("doesn't stack chevrons when the same way is travelled again", () => {
    const once = arrows([eastward], 8).length;
    const lap: Coordinate[] = [...eastward, [1, 0.0001], [0.0001, 0.0001]];
    const backAndForth = arrows(
      [
        lap,
        [
          [0.013, 0],
          [0.6, 0],
          [1, 0],
        ],
      ],
      8,
    );
    const eastbound = backAndForth.filter(([arm, tip]) => (tip?.[0] ?? 0) > (arm?.[0] ?? 0));
    const westbound = backAndForth.filter(([arm, tip]) => (tip?.[0] ?? 0) < (arm?.[0] ?? 0));
    expect(eastbound).toHaveLength(once);
    expect(westbound.length).toBeGreaterThan(0);
  });

  test("places a chevron every spacing in screen pixels", () => {
    const lengthPx = (zoom: number) => (512 * 2 ** zoom) / 360;
    expect(arrows([eastward], 8)).toHaveLength(Math.round(lengthPx(8) / 44));
    expect(arrows([eastward], 9)).toHaveLength(Math.round(lengthPx(9) / 44));
  });

  test("points each chevron along the direction of travel", () => {
    const westward = [...eastward].reverse();
    for (const [run, sign] of [
      [eastward, 1],
      [westward, -1],
    ] as const) {
      for (const [armA, tip, armB] of arrows([run], 8)) {
        expect(tip && armA && armB).toBeTruthy();
        if (!tip || !armA || !armB) continue;
        expect(sign * (tip[0] - armA[0])).toBeGreaterThan(0);
        expect(sign * (tip[0] - armB[0])).toBeGreaterThan(0);
        expect(Math.sign(armA[1] - tip[1])).toBe(-Math.sign(armB[1] - tip[1]));
      }
    }
  });

  test("drops chevrons well outside the visible area", () => {
    const all = arrows([eastward], 10);
    const visible = arrows([eastward], 10, [0, -0.1, 0.2, 0.1]);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(all.length / 2);
    expect(visible.every(([, tip]) => tip !== undefined && tip[0] <= 0.3)).toBe(true);
  });

  test("caps the number of chevrons", () => {
    expect(arrows([eastward], 15)).toHaveLength(600);
  });

  test("gives a short leg one chevron and skips a tiny one", () => {
    const short: Coordinate[] = [
      [0, 0],
      [0.0005, 0],
    ];
    expect(arrows([short], 14)).toHaveLength(1);
    expect(arrows([short], 9)).toHaveLength(0);
    expect(arrows([], 9)).toEqual([]);
  });
});

describe("timelineArrowViewport", () => {
  const view = { bounds: [0, 0, 1, 1] as [number, number, number, number], zoom: 10 };

  test("keeps the last viewport while the camera stays inside its padded area", () => {
    const followStep = {
      bounds: [0.3, 0.2, 1.3, 1.2] as [number, number, number, number],
      zoom: 10.05,
    };
    expect(timelineArrowViewport(view, followStep)).toBe(view);
  });

  test("moves on when the camera leaves the padded area or the zoom changes", () => {
    const farPan = { bounds: [2, 0, 3, 1] as [number, number, number, number], zoom: 10 };
    const zoomedIn = {
      bounds: [0.2, 0.2, 0.8, 0.8] as [number, number, number, number],
      zoom: 10.5,
    };
    expect(timelineArrowViewport(view, farPan)).toBe(farPan);
    expect(timelineArrowViewport(view, zoomedIn)).toBe(zoomedIn);
    expect(timelineArrowViewport(null, view)).toBe(view);
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

describe("timelineFitKeys", () => {
  const everyone = {
    dayKey: "2026-11-18",
    personId: null,
    ready: true,
    shownUserIds: ["alice", "bob", "carol"],
  };

  test("another person finishing decrypting doesn't refit the Everyone view", () => {
    const first = timelineFitKeys({ ...everyone, loaded: false, routeIds: ["a1"] });
    const second = timelineFitKeys({ ...everyone, loaded: false, routeIds: ["a1", "b1"] });
    expect(second.key).toBe(first.key);
  });

  test("refits when the first route arrives and when the load completes", () => {
    const none = timelineFitKeys({ ...everyone, loaded: false, routeIds: [] });
    const first = timelineFitKeys({ ...everyone, loaded: false, routeIds: ["a1"] });
    const done = timelineFitKeys({ ...everyone, loaded: true, routeIds: ["a1", "b1"] });
    expect(new Set([none.key, first.key, done.key]).size).toBe(3);
    expect(done.view).toBe(first.view);
  });

  test("a new person or device is a new view", () => {
    const alice = { ...everyone, loaded: true, personId: "alice" };
    expect(timelineFitKeys({ ...alice, routeIds: ["a1"] }).view).not.toBe(
      timelineFitKeys({ ...alice, routeIds: ["a2"] }).view,
    );
    expect(timelineFitKeys({ ...alice, routeIds: ["a1"] }).view).not.toBe(
      timelineFitKeys({ ...everyone, loaded: true, routeIds: ["a1"] }).view,
    );
  });
});
