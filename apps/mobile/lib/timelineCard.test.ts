import { describe, expect, test } from "bun:test";
import {
  timelineCardBoxMoved,
  timelineCardIsOpen,
  timelineCardOpens,
  timelineCardShift,
  timelineMiniClockScale,
} from "./timelineCard.ts";

describe("timelineCardIsOpen", () => {
  test("a collapsed card stays at mini size while the next day loads", () => {
    expect(timelineCardIsOpen({ canCollapse: false, expanded: false, loading: true })).toBe(false);
    expect(timelineCardIsOpen({ canCollapse: true, expanded: false, loading: false })).toBe(false);
  });

  test("an error or an empty day always shows the full card", () => {
    expect(timelineCardIsOpen({ canCollapse: false, expanded: false, loading: false })).toBe(true);
  });

  test("an expanded card stays open whatever is loading", () => {
    expect(timelineCardIsOpen({ canCollapse: false, expanded: true, loading: true })).toBe(true);
    expect(timelineCardIsOpen({ canCollapse: true, expanded: true, loading: false })).toBe(true);
  });
});

describe("timelineCardBoxMoved", () => {
  const box = { height: 36, width: 92, x: 0, y: 4 };

  test("a first measurement or a real move counts", () => {
    expect(timelineCardBoxMoved(undefined, box)).toBe(true);
    expect(timelineCardBoxMoved(box, { ...box, width: 104 })).toBe(true);
    expect(timelineCardBoxMoved(box, { ...box, y: 3.5 })).toBe(true);
  });

  test("sub-pixel layout noise does not", () => {
    expect(timelineCardBoxMoved(box, { ...box, height: 36.2, x: 0.3 })).toBe(false);
  });
});

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

describe("timelineCardShift", () => {
  test("moves an element's centre onto its mini slot through each parent's offset", () => {
    expect(
      timelineCardShift({
        from: [
          { height: 300, width: 320, x: 16, y: 20 },
          { height: 56, width: 320, x: 0, y: 200 },
          { height: 56, width: 56, x: 132, y: 0 },
        ],
        to: [
          { height: 48, width: 320, x: 16, y: 20 },
          { height: 48, width: 48, x: 0, y: 0 },
        ],
      }),
    ).toEqual({ scale: 48 / 56, x: -136, y: -204 });
  });

  test("scales by the slot's width so a shrunk clock fills its slot", () => {
    expect(
      timelineCardShift({
        from: [{ height: 40, width: 100, x: 0, y: 0 }],
        to: [{ height: 32, width: 80, x: 60, y: 4 }],
      }),
    ).toEqual({ scale: 0.8, x: 50, y: 0 });
  });

  test("stays put until every box in both chains has been measured", () => {
    const box = { height: 10, width: 10, x: 5, y: 5 };
    const still = { scale: 1, x: 0, y: 0 };
    expect(timelineCardShift({ from: [undefined, box], to: [box] })).toEqual(still);
    expect(timelineCardShift({ from: [box], to: [{ ...box, width: 0 }] })).toEqual(still);
    expect(timelineCardShift({ from: [box], to: [] })).toEqual(still);
  });
});

describe("timelineMiniClockScale", () => {
  test("shrinks the clock to four fifths when the mini row has room", () => {
    expect(timelineMiniClockScale({ available: 200, width: 120 })).toBe(0.8);
  });

  test("shrinks a large-text clock further so it fits beside the play button and speed", () => {
    expect(timelineMiniClockScale({ available: 150, width: 300 })).toBe(0.5);
  });

  test("keeps the usual size until both widths are known", () => {
    expect(timelineMiniClockScale({ available: 0, width: 300 })).toBe(0.8);
    expect(timelineMiniClockScale({ available: 150, width: 0 })).toBe(0.8);
  });
});
