import { describe, expect, test } from "bun:test";
import { mapEdgePoint } from "./mapEdgePoint.ts";

describe("mapEdgePoint", () => {
  test("hides points inside the map and projects off-screen points toward the edge", () => {
    expect(mapEdgePoint({ width: 400, height: 600, point: [200, 300] })).toBeNull();
    expect(mapEdgePoint({ width: 400, height: 600, point: [600, 300] })).toEqual({
      angle: 90,
      x: 370,
      y: 300,
    });
    expect(mapEdgePoint({ width: 400, height: 600, point: [200, -300] })).toEqual({
      angle: 0,
      x: 200,
      y: 30,
    });
    const corner = mapEdgePoint({ width: 400, height: 600, point: [600, 700] });
    expect(corner).toMatchObject({ x: 370, y: 570 });
    expect(corner?.angle).toBeGreaterThan(90);
    expect(corner?.angle).toBeLessThan(180);
  });
});

describe("map edge control boundary", () => {
  test("routes a pin around the measured map controls", () => {
    const result = mapEdgePoint({
      width: 400,
      height: 600,
      point: [700, 100],
      controls: { x: 344, y: 56, width: 44, height: 152 },
    });
    expect(result).not.toBeNull();
    expect(result && (result.x <= 316 || result.y <= 28 || result.y >= 236)).toBe(true);
  });
});

test("routes around controls and handles a covered map", () => {
  const routed = mapEdgePoint({
    width: 400,
    height: 600,
    point: [900, -150],
    controls: { x: 344, y: 56, width: 44, height: 152 },
  });
  expect(routed && (routed.x <= 316 || routed.y <= 28 || routed.y >= 236)).toBe(true);
  expect(
    mapEdgePoint({
      width: 100,
      height: 100,
      point: [200, 50],
      controls: { x: 0, y: 0, width: 100, height: 100 },
    }),
  ).toBeNull();
});

test("moves continuously around controls as the map pans", () => {
  let previous: { x: number; y: number } | null = null;
  for (let edgeY = 31; edgeY <= 245; edgeY += 1) {
    const point = mapEdgePoint({
      width: 400,
      height: 600,
      point: [600, edgeY],
      controls: { x: 344, y: 56, width: 44, height: 152 },
    });
    expect(point).not.toBeNull();
    if (point && previous)
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(4);
    previous = point;
  }
});

test("moves continuously across corners around the control stack", () => {
  let previous: { x: number; y: number } | null = null;
  for (let step = 0; step <= 720; step += 1) {
    const angle = (step * Math.PI) / 360;
    const point = mapEdgePoint({
      width: 400,
      height: 600,
      point: [200 + 1000 * Math.cos(angle), 300 + 1000 * Math.sin(angle)],
      controls: { x: 344, y: 56, width: 44, height: 152 },
    });
    expect(point).not.toBeNull();
    if (point && previous)
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(12);
    if (point) expect(point.x <= 316 || point.y <= 28 || point.y >= 236).toBe(true);
    previous = point;
  }
});

test("keeps an off-screen pin aligned with the map during a horizontal pan", () => {
  const before = mapEdgePoint({ width: 400, height: 600, point: [-100, 100] });
  const after = mapEdgePoint({ width: 400, height: 600, point: [-200, 100] });
  expect(before?.y).toBe(100);
  expect(after?.y).toBe(100);
});
