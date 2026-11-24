import { expect, test } from "bun:test";
import {
  continueLiveMapPinGlide,
  type LiveMapPinGlide,
  liveMapPinGlideOffsetPosition,
  liveMapPinGlidePosition,
  restingLiveMapPinGlide,
} from "./liveMapPinGlide.ts";

const START = Date.parse("2026-11-23T10:00:00.000Z");
const METERS_PER_DEGREE = 111_320;

const fixAt = ({
  northMeters,
  eastMeters = 0,
  seconds,
}: {
  northMeters: number;
  eastMeters?: number;
  seconds: number;
}) => ({
  latitude: northMeters / METERS_PER_DEGREE,
  longitude: eastMeters / METERS_PER_DEGREE,
  timestamp: new Date(START + seconds * 1_000).toISOString(),
});

const northMetersAt = (glide: LiveMapPinGlide, seconds: number) =>
  liveMapPinGlidePosition(glide, START + seconds * 1_000).latitude * METERS_PER_DEGREE;

const eastMetersAt = (glide: LiveMapPinGlide, seconds: number) =>
  liveMapPinGlidePosition(glide, START + seconds * 1_000).longitude * METERS_PER_DEGREE;

const firstTwoLocations = () => {
  const first = continueLiveMapPinGlide(
    undefined,
    fixAt({ northMeters: 0, seconds: 0 }),
    START + 1_000,
  );
  return continueLiveMapPinGlide(first, fixAt({ northMeters: 130, seconds: 10 }), START + 11_000);
};

test("a pin's first location is shown where it was reported, without moving", () => {
  const glide = continueLiveMapPinGlide(
    undefined,
    fixAt({ northMeters: 50, seconds: 0 }),
    START + 1_000,
  );

  expect(liveMapPinGlidePosition(glide, START + 1_000)).toEqual({
    latitude: 50 / METERS_PER_DEGREE,
    longitude: 0,
    settled: true,
  });
});

test("a pin takes as long to reach a new location as the person took, plus two seconds for a late update", () => {
  const glide = firstTwoLocations();

  expect(northMetersAt(glide, 11)).toBeCloseTo(0, 6);
  expect(northMetersAt(glide, 17)).toBeCloseTo(65, 6);
  expect(liveMapPinGlidePosition(glide, START + 22_999).settled).toBe(false);
  expect(northMetersAt(glide, 23)).toBeCloseTo(130, 6);
  expect(liveMapPinGlidePosition(glide, START + 23_000).settled).toBe(true);
});

test("a pin with no new location stops at the last one it was given", () => {
  const glide = firstTwoLocations();

  expect(northMetersAt(glide, 600)).toBeCloseTo(130, 6);
});

test("a pin still on its way heads for the newer location from where it is drawn", () => {
  const second = firstTwoLocations();
  const third = continueLiveMapPinGlide(
    second,
    fixAt({ northMeters: 130, eastMeters: 120, seconds: 20 }),
    START + 17_000,
  );

  expect(northMetersAt(third, 17)).toBeCloseTo(65, 6);
  expect(eastMetersAt(third, 17)).toBeCloseTo(0, 6);
  expect(northMetersAt(third, 23)).toBeCloseTo(65 + 65 / 2, 6);
  expect(eastMetersAt(third, 23)).toBeCloseTo(60, 6);
  expect(northMetersAt(third, 29)).toBeCloseTo(130, 6);
  expect(eastMetersAt(third, 29)).toBeCloseTo(120, 6);
});

test("a pin on a steady journey keeps moving without stopping between updates", () => {
  let glide = continueLiveMapPinGlide(undefined, fixAt({ northMeters: 0, seconds: 0 }), START);
  let previous = 0;
  for (let update = 1; update <= 6; update += 1) {
    const arrivalSeconds = update * 10 + 1;
    glide = continueLiveMapPinGlide(
      glide,
      fixAt({ northMeters: update * 130, seconds: update * 10 }),
      START + arrivalSeconds * 1_000,
    );
    for (let second = arrivalSeconds + 1; second <= arrivalSeconds + 10; second += 1) {
      const shown = northMetersAt(glide, second);
      expect(shown).toBeGreaterThan(previous);
      expect(shown).toBeLessThanOrEqual(update * 130);
      previous = shown;
    }
  }
});

test("a location long after the last one is shown straight away", () => {
  const glide = continueLiveMapPinGlide(
    firstTwoLocations(),
    fixAt({ northMeters: 5_000, seconds: 300 }),
    START + 301_000,
  );

  expect(liveMapPinGlidePosition(glide, START + 301_000)).toEqual({
    latitude: 5_000 / METERS_PER_DEGREE,
    longitude: 0,
    settled: true,
  });
});

test("a slow phone's pin takes no longer than a minute and a half to catch up", () => {
  const glide = continueLiveMapPinGlide(
    firstTwoLocations(),
    fixAt({ northMeters: 400, seconds: 130 }),
    START + 131_000,
  );

  expect(northMetersAt(glide, 131 + 89)).toBeLessThan(400);
  expect(northMetersAt(glide, 131 + 90)).toBeCloseTo(400, 6);
});

test.each([
  ["a location taken before the one already shown", fixAt({ northMeters: 60, seconds: 5 })],
  ["a location with no time", { ...fixAt({ northMeters: 60, seconds: 20 }), timestamp: null }],
])("%s is shown straight away", (_, fix) => {
  const glide = continueLiveMapPinGlide(firstTwoLocations(), fix, START + 21_000);

  expect(northMetersAt(glide, 21)).toBeCloseTo(60, 6);
});

test("the same location again keeps the pin's movement going", () => {
  const glide = firstTwoLocations();

  expect(
    continueLiveMapPinGlide(glide, fixAt({ northMeters: 130, seconds: 10 }), START + 15_000),
  ).toBe(glide);
});

test("a stack of pins moves by the average of its members' movement", () => {
  const moving = firstTwoLocations();
  const still = restingLiveMapPinGlide({ latitude: 0, longitude: 0 }, START);

  const shown = liveMapPinGlideOffsetPosition({
    base: { latitude: 1, longitude: 2 },
    glides: [moving, still],
    nowMs: START + 17_000,
  });

  expect((shown.latitude - 1) * METERS_PER_DEGREE).toBeCloseTo(-65 / 2, 6);
  expect(shown.longitude).toBeCloseTo(2, 9);
  expect(shown.settled).toBe(false);
  expect(
    liveMapPinGlideOffsetPosition({
      base: { latitude: 1, longitude: 2 },
      glides: [],
      nowMs: START,
    }),
  ).toEqual({ latitude: 1, longitude: 2, settled: true });
});

test("a location that arrives long after the person took it, after the map was away, is shown straight away", () => {
  const glide = continueLiveMapPinGlide(
    firstTwoLocations(),
    fixAt({ northMeters: 400, seconds: 100 }),
    START + 11_000 + 90_000 + 30_001,
  );

  expect(liveMapPinGlidePosition(glide, START + 131_001)).toEqual({
    latitude: 400 / METERS_PER_DEGREE,
    longitude: 0,
    settled: true,
  });
});

test("a location that arrives a little late still glides", () => {
  const glide = continueLiveMapPinGlide(
    firstTwoLocations(),
    fixAt({ northMeters: 260, seconds: 20 }),
    START + 11_000 + 10_000 + 30_000,
  );

  expect(liveMapPinGlidePosition(glide, START + 51_000).settled).toBe(false);
});

test("a still person's small GPS wobble is shown straight away without gliding", () => {
  const glide = continueLiveMapPinGlide(
    continueLiveMapPinGlide(undefined, fixAt({ northMeters: 0, seconds: 0 }), START + 1_000),
    fixAt({ northMeters: 3, eastMeters: 3, seconds: 10 }),
    START + 11_000,
  );

  expect(liveMapPinGlidePosition(glide, START + 11_000)).toEqual({
    latitude: 3 / METERS_PER_DEGREE,
    longitude: 3 / METERS_PER_DEGREE,
    settled: true,
  });
});

test("a pin crossing the 180th meridian takes the short way round", () => {
  const first = continueLiveMapPinGlide(
    undefined,
    { latitude: 0, longitude: 179.9, timestamp: new Date(START).toISOString() },
    START,
  );
  const glide = continueLiveMapPinGlide(
    first,
    {
      latitude: 0,
      longitude: -179.9,
      timestamp: new Date(START + 10_000).toISOString(),
    },
    START + 10_000,
  );

  const quarter = liveMapPinGlidePosition(glide, START + 13_000);
  const threeQuarters = liveMapPinGlidePosition(glide, START + 19_000);
  expect(quarter.longitude).toBeCloseTo(179.95, 9);
  expect(threeQuarters.longitude).toBeCloseTo(-179.95, 9);
  expect(threeQuarters.longitude).toBeGreaterThanOrEqual(-180);
  expect(liveMapPinGlidePosition(glide, START + 22_000).longitude).toBe(-179.9);
  expect(
    liveMapPinGlideOffsetPosition({
      base: { latitude: 0, longitude: -179.9 },
      glides: [glide],
      nowMs: START + 13_000,
    }).longitude,
  ).toBeCloseTo(179.95, 9);
});
