import { expect, test } from "bun:test";
import { timelinePositionAt } from "./timeline.ts";
import {
  packTimelineTrack,
  timelineMinuteLabelAt,
  timelineMinuteLabels,
  timelineTrackCoordinateAt,
  timelineTrackSegmentAt,
  timelineTrackStateKey,
} from "./timelineTrack.ts";
import type { TimelinePosition, TimelineSegment } from "./timelineTypes.ts";

const at = (
  latitude: number,
  longitude: number,
  speed: number | null = null,
): TimelinePosition => ({
  accuracy: 5,
  latitude,
  longitude,
  speed,
});
const MIN = 60_000;

const segments: TimelineSegment[] = [
  { kind: "stay", start: 0, end: 10 * MIN, position: at(51.5, -0.1) },
  { kind: "moving", start: 10 * MIN, end: 11 * MIN, from: at(51.5, -0.1), to: at(51.51, -0.09) },
  { kind: "moving", start: 11 * MIN, end: 12 * MIN, from: at(51.51, -0.09), to: at(51.52, -0.1) },
  { kind: "pause", start: 12 * MIN, end: 20 * MIN, from: at(51.52, -0.1), to: at(51.6, -0.2) },
  { kind: "moving", start: 20 * MIN, end: 21 * MIN, from: at(51.6, -0.2), to: at(51.61, -0.21) },
  { kind: "stay", start: 21 * MIN, end: 30 * MIN, position: at(51.61, -0.21) },
  { kind: "noLocation", start: 30 * MIN, end: 50 * MIN },
  { kind: "moving", start: 50 * MIN, end: 51 * MIN, from: at(51.7, -0.3), to: at(51.71, -0.31) },
  { kind: "stay", start: 60 * MIN, end: 70 * MIN, position: at(51.72, -0.32) },
];

test("the packed track finds the same place as the Timeline model at every moment", () => {
  const track = packTimelineTrack(segments);
  const times = [
    -1,
    ...segments.flatMap((segment) => [
      segment.start - 1,
      segment.start,
      segment.end,
      segment.end + 1,
    ]),
    ...Array.from({ length: 500 }, (_, index) => (index * 71 * MIN) / 500 + 0.37),
  ];
  for (const time of times) {
    const expected = timelinePositionAt(segments, time);
    const index = timelineTrackSegmentAt(track, time);
    if (expected.position === null) {
      expect(index).toBe(-1);
      continue;
    }
    expect(index).not.toBe(-1);
    const [longitude, latitude] = timelineTrackCoordinateAt(track, index, time);
    expect(latitude).toBeCloseTo(expected.position.latitude, 10);
    expect(longitude).toBeCloseTo(expected.position.longitude, 10);
    expect(segments[index]?.kind).toBe(expected.state);
  }
});

test("back-to-back moving segments share one status so scrubbing through a trip doesn't churn", () => {
  const track = packTimelineTrack(segments);
  expect([...track.status]).toEqual([0, 1, 1, 3, 4, 5, 6, 7, 8]);
});

test("the state key changes when a pin appears, disappears or pauses, or the picked person's status changes", () => {
  const track = packTimelineTrack(segments);
  const picked = (time: number) => timelineTrackStateKey([track], track, time);
  const everyone = (time: number) => timelineTrackStateKey([track], null, time);
  expect(picked(10.2 * MIN)).toBe(picked(11.7 * MIN));
  expect(picked(5 * MIN)).not.toBe(picked(10.5 * MIN));
  expect(everyone(5 * MIN)).toBe(everyone(10.5 * MIN));
  expect(everyone(15 * MIN)).not.toBe(everyone(11.5 * MIN));
  expect(everyone(40 * MIN)).not.toBe(everyone(25 * MIN));
  expect(picked(40 * MIN)).toBe("n|-1");
});

test("an empty track has no position", () => {
  expect(timelineTrackSegmentAt(packTimelineTrack([]), 5)).toBe(-1);
});

test("minute labels cover every minute of the day, including clock-change days", () => {
  const start = new Date(2026, 9, 25).getTime();
  const end = new Date(2026, 9, 26).getTime();
  const format = (time: number) => new Date(time).toISOString().slice(11, 16);
  const labels = timelineMinuteLabels({ end, start }, format);
  expect(labels.length).toBe(Math.ceil((end - start) / MIN));
  expect(timelineMinuteLabelAt(labels, "24:00", { end, start }, start + 90.5 * MIN)).toBe(
    format(start + 90 * MIN),
  );
  expect(timelineMinuteLabelAt(labels, "24:00", { end, start }, end)).toBe("24:00");
  expect(timelineMinuteLabelAt(labels, "24:00", { end, start }, start - MIN)).toBe(labels[0] ?? "");
});
