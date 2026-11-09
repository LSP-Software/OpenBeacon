import { describe, expect, test } from "bun:test";
import { mergeClosestPairs } from "./mergeClosestPairs.ts";

const mergeNumbers = (clusters: readonly number[], mergeDistance: number) =>
  mergeClosestPairs({
    clusters,
    distanceBetween: (first, second) => Math.abs(first - second),
    mergeDistanceFor: () => mergeDistance,
    merge: (first, second) => (first + second) / 2,
  });

describe("mergeClosestPairs", () => {
  test("merges the closest pair first", () => {
    expect(mergeNumbers([0, 6, 7], 3)).toEqual([0, 6.5]);
  });

  test("keeps merging until nothing is within range", () => {
    expect(mergeNumbers([0, 2, 3], 3)).toEqual([1.25]);
  });

  test("does not change the input", () => {
    const clusters = [0, 1];
    mergeNumbers(clusters, 3);
    expect(clusters).toEqual([0, 1]);
  });
});
