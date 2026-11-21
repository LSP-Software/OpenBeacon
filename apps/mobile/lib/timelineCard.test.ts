import { describe, expect, test } from "bun:test";
import { timelineCardOpens } from "./timelineCard.ts";

describe("timelineCardOpens", () => {
  test("a flick decides the card's state wherever it is let go", () => {
    expect(timelineCardOpens({ progress: 0.9, velocity: 0.6 })).toBe(false);
    expect(timelineCardOpens({ progress: 0.1, velocity: -0.6 })).toBe(true);
  });

  test("a slow drag settles on whichever state is nearer", () => {
    expect(timelineCardOpens({ progress: 0.6, velocity: 0.1 })).toBe(true);
    expect(timelineCardOpens({ progress: 0.4, velocity: -0.1 })).toBe(false);
  });
});
