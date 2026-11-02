import { describe, expect, test } from "bun:test";
import { mapViewportPoint } from "./mapViewportPoint.ts";

describe("mapViewportPoint", () => {
  test("projects coordinates into the current visible map bounds", () => {
    const bounds: [[number, number], [number, number]] = [
      [10, 10],
      [-10, -10],
    ];
    const center = mapViewportPoint({ bounds, coordinate: [0, 0], width: 400, height: 600 });
    const outside = mapViewportPoint({ bounds, coordinate: [20, 0], width: 400, height: 600 });
    expect(center?.[0]).toBeCloseTo(200);
    expect(center?.[1]).toBeCloseTo(300);
    expect(outside?.[0]).toBeCloseTo(600);
    expect(outside?.[1]).toBeCloseTo(300);
  });

  test("handles the antimeridian and rejects degenerate bounds", () => {
    const point = mapViewportPoint({
      bounds: [
        [-170, 10],
        [170, -10],
      ],
      coordinate: [-179, 0],
      width: 400,
      height: 600,
    });
    expect(point?.[0]).toBeCloseTo(220);
    expect(point?.[1]).toBeCloseTo(300);
    expect(
      mapViewportPoint({
        bounds: [
          [0, 0],
          [0, 0],
        ],
        coordinate: [0, 0],
        width: 400,
        height: 600,
      }),
    ).toBeNull();
  });
});
