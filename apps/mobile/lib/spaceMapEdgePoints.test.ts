import { describe, expect, test } from "bun:test";
import { spaceMapEdgePoints } from "./spaceMapEdgePoints.ts";

describe("spaceMapEdgePoints", () => {
  test("keeps people at the same off-screen location separately tappable", () => {
    const result = spaceMapEdgePoints({
      width: 400,
      height: 600,
      controls: { x: 344, y: 56, width: 44, height: 152 },
      points: [
        { userId: "a", x: 30, y: 300, angle: -90 },
        { userId: "b", x: 30, y: 300, angle: -90 },
      ],
    });
    expect(result).toHaveLength(2);
    expect(
      Math.hypot(
        (result[0]?.x ?? 0) - (result[1]?.x ?? 0),
        (result[0]?.y ?? 0) - (result[1]?.y ?? 0),
      ),
    ).toBeGreaterThanOrEqual(48);
  });
  test("keeps a cluster near the map edge and out from under controls", () => {
    const result = spaceMapEdgePoints({
      width: 400,
      height: 600,
      controls: { x: 344, y: 56, width: 44, height: 152 },
      points: [
        { userId: "a", x: 200, y: 30, angle: 0 },
        { userId: "b", x: 200, y: 30, angle: 0 },
        { userId: "c", x: 200, y: 30, angle: 0 },
      ],
    });
    expect(result.every((point) => point.y <= 134)).toBe(true);
    expect(result.every((point) => point.x <= 316 || point.y <= 28 || point.y >= 236)).toBe(true);
    for (const [index, point] of result.entries()) {
      for (const other of result.slice(index + 1)) {
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(48);
      }
    }
  });
  test("does not flip clustered pins when their projected positions cross", () => {
    const inputs = { width: 400, height: 600, controls: null };
    const first = spaceMapEdgePoints({
      ...inputs,
      points: [
        { userId: "a", x: 30, y: 300, angle: -90 },
        { userId: "b", x: 30, y: 299.9, angle: -90 },
      ],
    });
    const second = spaceMapEdgePoints({
      ...inputs,
      previous: first,
      points: [
        { userId: "a", x: 30, y: 300, angle: -90 },
        { userId: "b", x: 30, y: 300.1, angle: -90 },
      ],
    });
    expect(Math.abs((first[1]?.y ?? 0) - (second[1]?.y ?? 0))).toBeLessThan(4);
  });
  test("moves continuously as clustered pins pass each other", () => {
    let previous: { x: number; y: number } | undefined;
    for (let y = 248; y <= 352; y += 1) {
      const result = spaceMapEdgePoints({
        width: 400,
        height: 600,
        controls: null,
        points: [
          { userId: "a", x: 30, y: 300, angle: -90 },
          { userId: "b", x: 30, y, angle: -90 },
        ],
      });
      const point = result[1];
      if (point && previous)
        expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(11);
      previous = point;
    }
  });
  test("keeps three clustered pins continuous as one passes the others", () => {
    let previous: ReturnType<typeof spaceMapEdgePoints> = [];
    for (let step = 0; step <= 280; step += 1) {
      const result = spaceMapEdgePoints({
        width: 400,
        height: 600,
        controls: null,
        previous,
        points: [
          { userId: "a", x: 30, y: 300, angle: -90 },
          { userId: "b", x: 30, y: 300, angle: -90 },
          { userId: "c", x: 30, y: 230 + step / 2, angle: -90 },
        ],
      });
      const point = result[2];
      const before = previous[2];
      if (point && before)
        expect(Math.hypot(point.x - before.x, point.y - before.y)).toBeLessThan(11);
      if (point)
        for (const other of result.slice(0, 2))
          expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(47.99);
      previous = result;
    }
  });
  test("does not place an edge pin over an on-screen person", () => {
    const result = spaceMapEdgePoints({
      width: 400,
      height: 600,
      controls: null,
      occupied: [{ x: 82, y: 300 }],
      points: [
        { userId: "a", x: 30, y: 300, angle: -90 },
        { userId: "b", x: 30, y: 300, angle: -90 },
      ],
    });
    expect(result).toHaveLength(2);
    for (const point of result)
      expect(Math.hypot(point.x - 82, point.y - 300)).toBeGreaterThanOrEqual(48);
  });
  test("moves continuously when an on-screen pin approaches an edge pin", () => {
    let previous: ReturnType<typeof spaceMapEdgePoints> = [];
    for (let step = 0; step <= 80; step += 1) {
      const result = spaceMapEdgePoints({
        width: 400,
        height: 600,
        controls: null,
        previous,
        occupied: [{ x: 84 - step / 10, y: 300 }],
        points: [{ userId: "a", x: 30, y: 300, angle: -90 }],
      });
      const point = result[0];
      const before = previous[0];
      if (point && before)
        expect(Math.hypot(point.x - before.x, point.y - before.y)).toBeLessThan(5);
      if (point)
        expect(Math.hypot(point.x - (84 - step / 10), point.y - 300)).toBeGreaterThanOrEqual(47.99);
      previous = result;
    }
  });
  test("does not jump when an on-screen pin moves past a corner", () => {
    let previous: ReturnType<typeof spaceMapEdgePoints> = [];
    for (let step = 0; step <= 240; step += 1) {
      const y = 30 + step / 2;
      const result = spaceMapEdgePoints({
        width: 400,
        height: 600,
        controls: null,
        previous,
        occupied: [{ x: 40, y }],
        points: [{ userId: "a", x: 30, y: 30, angle: 0 }],
      });
      const point = result[0];
      const before = previous[0];
      if (point && before)
        expect(Math.hypot(point.x - before.x, point.y - before.y)).toBeLessThan(12);
      if (point) expect(Math.hypot(point.x - 40, point.y - y)).toBeGreaterThanOrEqual(47.99);
      previous = result;
    }
  });
});
