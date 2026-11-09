import { describe, expect, test } from "bun:test";
import { mergeMapEdgePoints } from "./mergeMapEdgePoints.ts";

describe("mergeMapEdgePoints", () => {
  test("merges chips that would touch into one chip for all of them", () => {
    const chips = mergeMapEdgePoints({
      points: [
        { userId: "b", x: 30, y: 300, angle: -90 },
        { userId: "a", x: 30, y: 320, angle: -90 },
        { userId: "c", x: 30, y: 500, angle: -90 },
      ],
    });

    expect(chips.map((chip) => chip.memberIds)).toEqual([["a", "b"], ["c"]]);
    expect(chips[0]).toMatchObject({ userId: "a", x: 30, y: 310 });
  });

  test("points a merged chip between its members", () => {
    const [chip] = mergeMapEdgePoints({
      points: [
        { userId: "a", x: 200, y: 30, angle: -30 },
        { userId: "b", x: 200, y: 40, angle: 30 },
      ],
    });

    expect(chip?.angle).toBeCloseTo(0);
  });

  test("holds chips together until they are clearly apart", () => {
    const points = [
      { userId: "a", x: 30, y: 300, angle: -90 },
      { userId: "b", x: 30, y: 360, angle: -90 },
    ];

    expect(mergeMapEdgePoints({ points })).toHaveLength(2);
    expect(mergeMapEdgePoints({ points, previous: [{ memberIds: ["a", "b"] }] })).toHaveLength(1);
  });
});
