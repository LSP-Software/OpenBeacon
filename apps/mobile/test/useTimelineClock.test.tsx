import { expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let frame: ((info: { timeSincePreviousFrame: number | null }) => void) | null = null;
mock.module("react-native-reanimated", () => ({
  useAnimatedReaction: () => {},
  useFrameCallback: (callback: NonNullable<typeof frame>) => {
    frame = callback;
    return { setActive: () => {} };
  },
  useSharedValue: <T,>(value: T) => React.useRef({ value }).current,
}));
mock.module("react-native-worklets", () => ({
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
}));

const { useTimelineClock } = await import("../hooks/useTimelineClock.ts");

type Clock = ReturnType<typeof useTimelineClock>;
type Props = Omit<Parameters<typeof useTimelineClock>[0], "selectedTrack" | "tracks">;

const HOUR = 60 * 60_000;

const renderClock = async (props: Props) => {
  const current: { clock: Clock | null } = { clock: null };
  const Harness = (harness: Props) => {
    current.clock = useTimelineClock({ ...harness, selectedTrack: null, tracks: [] });
    return null;
  };
  const root = createRoot();
  await act(async () => root.render(<Harness {...props} />));
  const clock = () => {
    if (!current.clock) throw new Error("clock not rendered");
    return current.clock;
  };
  return {
    clock,
    rerender: (next: Props) => act(async () => root.render(<Harness {...next} />)),
    run: (action: (clock: Clock) => void) => act(async () => action(clock())),
    unmount: () => act(async () => root.unmount()),
  };
};

test("an untouched day follows its starting point as new locations arrive", async () => {
  const view = await renderClock({ dayKey: "mon", from: 0, startTime: 5 * HOUR, to: 10 * HOUR });
  expect(view.clock().time.value).toBe(5 * HOUR);
  await view.rerender({ dayKey: "mon", from: 0, startTime: 6 * HOUR, to: 10 * HOUR });
  expect(view.clock().time.value).toBe(6 * HOUR);
  expect(view.clock().shownTime).toBe(6 * HOUR);
  expect(view.clock().scrubbed).toBe(false);
  await view.unmount();
});

test("a chosen time stays put when new locations arrive, and comes back after visiting another day", async () => {
  const view = await renderClock({ dayKey: "mon", from: 0, startTime: 5 * HOUR, to: 10 * HOUR });
  await view.run((clock) => clock.seek(2 * HOUR));
  await view.rerender({ dayKey: "mon", from: 0, startTime: 6 * HOUR, to: 11 * HOUR });
  expect(view.clock().time.value).toBe(2 * HOUR);
  expect(view.clock().scrubbed).toBe(true);
  await view.rerender({ dayKey: "sun", from: 0, startTime: 9 * HOUR, to: 24 * HOUR });
  expect(view.clock().time.value).toBe(9 * HOUR);
  expect(view.clock().scrubbed).toBe(false);
  await view.rerender({ dayKey: "mon", from: 0, startTime: 6 * HOUR, to: 11 * HOUR });
  expect(view.clock().time.value).toBe(2 * HOUR);
  await view.unmount();
});

test("seeking stays inside the shown hours and stops playback", async () => {
  const view = await renderClock({ dayKey: "mon", from: HOUR, startTime: 5 * HOUR, to: 10 * HOUR });
  await view.run((clock) => clock.play(3 * HOUR));
  expect(view.clock().playing).toBe(true);
  await view.run((clock) => clock.seek(0));
  expect(view.clock().time.value).toBe(HOUR);
  expect(view.clock().playing).toBe(false);
  await view.run((clock) => clock.seek(30 * HOUR));
  expect(view.clock().time.value).toBe(10 * HOUR);
  await view.unmount();
});

test("playback advances by the speed and stops at the end of the shown hours", async () => {
  const view = await renderClock({ dayKey: "mon", from: 0, startTime: 0, to: 2 * HOUR });
  await view.run((clock) => clock.setSpeed(300));
  await view.run((clock) => clock.play(HOUR));
  await act(async () => frame?.({ timeSincePreviousFrame: 6_000 }));
  expect(view.clock().time.value).toBe(HOUR + 6_000 * 300);
  await act(async () => frame?.({ timeSincePreviousFrame: 60_000 }));
  expect(view.clock().time.value).toBe(2 * HOUR);
  expect(view.clock().playing).toBe(false);
  expect(view.clock().shownTime).toBe(2 * HOUR);
  await view.unmount();
});

test("dragging the scrubber stops playback and remembers where it was let go", async () => {
  const view = await renderClock({ dayKey: "mon", from: 0, startTime: 0, to: 10 * HOUR });
  await view.run((clock) => clock.play(HOUR));
  await act(async () => view.clock().scrubber.onBegin());
  expect(view.clock().playing).toBe(false);
  view.clock().time.value = 4 * HOUR;
  await act(async () => view.clock().scrubber.onEnd(4 * HOUR));
  expect(view.clock().shownTime).toBe(4 * HOUR);
  expect(view.clock().scrubbed).toBe(true);
  await view.unmount();
});
