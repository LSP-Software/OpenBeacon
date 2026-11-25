import { expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";
import type { SharedValue } from "react-native-reanimated";
import type { TestGestureHandlers } from "./gestureHandlerTestModule.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const element =
  (type: string) =>
  ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement(type, props, children);

let fontScale = 1;
mock.module("react-native", () => ({
  useWindowDimensions: () => ({ fontScale }),
  View: element("view"),
}));
mock.module("react-native-reanimated", () => ({
  default: { View: element("animated-view") },
  useAnimatedStyle: (style: () => object) => style(),
  useDerivedValue: <T,>(value: () => T) => ({
    get value() {
      return value();
    },
  }),
  useSharedValue: <T,>(value: T) => React.useRef({ value }).current,
}));
mock.module("react-native-svg", () => ({
  Defs: element("defs"),
  Line: element("line"),
  Pattern: element("pattern"),
  Rect: element("rect"),
  default: element("svg"),
}));
mock.module("../lib/theme.ts", () => ({
  useColors: () => new Proxy({}, { get: () => "#000000" }),
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: element("text") }));

const { TimelineKey, TimelineScrubber } =
  await import("../components/timeline/TimelineScrubber.tsx");

const sharedValue = (value: number) => ({ value }) as unknown as SharedValue<number>;

const testClock = (time: number) => ({
  onBegin: () => {},
  onEnd: () => {},
  time: sharedValue(time),
});

const ticksFor = async (uses24HourClock: boolean, scale = 1, trackWidth = 320) => {
  fontScale = scale;
  const start = new Date(2026, 10, 19).getTime();
  const end = new Date(2026, 10, 20).getTime();
  const root = createRoot();
  const scrubber = (
    <TimelineScrubber
      day={{ end, start }}
      from={start}
      historyStart={start}
      clock={testClock(start)}
      lanes={[]}
      onSeek={() => {}}
      step={15 * 60_000}
      to={end}
      uses24HourClock={uses24HourClock}
      valueLabel="00:00"
    />
  );
  await act(async () => root.render(scrubber));
  const track = root.container.queryAll(
    (node) => node.type === "view" && node.props["accessibilityLabel"] === "Time of day",
  )[0];
  const onLayout = track?.props["onLayout"] as
    ((event: { nativeEvent: { layout: { width: number } } }) => void) | undefined;
  await act(async () => onLayout?.({ nativeEvent: { layout: { width: trackWidth } } }));
  const ticks = root.container
    .queryAll(
      (node) =>
        node.type === "text" && node.props["className"] === "absolute text-xs text-secondary",
    )
    .map((node) => String(node.children.join("")).replace(/\s/g, " "));
  await act(async () => root.unmount());
  fontScale = 1;
  return ticks;
};

test("the scrubber's hour marks follow the phone's 12 or 24-hour clock", async () => {
  expect(await ticksFor(true)).toEqual(["00", "06", "12", "18", "24"]);
  expect(await ticksFor(false)).toEqual(["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"]);
});

test("at large text sizes the 12-hour marks thin out so they never collide", async () => {
  expect(await ticksFor(true, 2, 300)).toEqual(["00", "06", "12", "18", "24"]);
  expect(await ticksFor(false, 2, 300)).toEqual(["12 AM", "12 PM", "12 AM"]);
  expect(await ticksFor(false, 1, 300)).toEqual(["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"]);
});

test("time before history starts is drawn apart from the no-location hatch", async () => {
  const start = new Date(2026, 10, 19).getTime();
  const end = new Date(2026, 10, 20).getTime();
  const hour = 60 * 60_000;
  const root = createRoot();
  await act(async () =>
    root.render(
      <TimelineScrubber
        day={{ end, start }}
        from={start + 2 * hour}
        historyStart={start + 2 * hour}
        lanes={[
          {
            color: "#ff0000",
            historyStart: start + 4 * hour,
            id: "lane",
            initials: "AB",
            drives: [],
            runs: [{ end: start + 6 * hour, kind: "noLocation", start: start + 5 * hour }],
          },
        ]}
        clock={testClock(start + 2 * hour)}
        onSeek={() => {}}
        step={15 * 60_000}
        to={end}
        uses24HourClock
        valueLabel="02:00"
      />,
    ),
  );
  const track = root.container.queryAll(
    (node) => node.type === "view" && node.props["accessibilityLabel"] === "Time of day",
  )[0];
  const onLayout = track?.props["onLayout"] as
    ((event: { nativeEvent: { layout: { width: number } } }) => void) | undefined;
  await act(async () => onLayout?.({ nativeEvent: { layout: { width: 240 } } }));
  const fills = root.container
    .queryAll((node) => node.type === "rect" && node.parent?.type === "svg")
    .map((node) => ({ fill: node.props["fill"], x: node.props["x"] }));
  await act(async () => root.unmount());
  expect(fills).toEqual([
    { fill: "#000000", x: 20 },
    { fill: "url(#timeline-hatch)", x: 50 },
    { fill: "#000000", x: 0 },
  ]);
});

const renderTrack = async ({ from, to }: { from: number; to: number }) => {
  const start = new Date(2026, 10, 19).getTime();
  const hour = 60 * 60_000;
  const events: string[] = [];
  const seeks: number[] = [];
  const clock = {
    onBegin: () => {
      events.push("begin");
    },
    onEnd: (time: number) => {
      events.push(`end ${(time - start) / hour}`);
    },
    time: sharedValue(start),
  };
  const root = createRoot();
  await act(async () =>
    root.render(
      <TimelineScrubber
        clock={clock}
        day={{ end: start + 24 * hour, start }}
        from={start + from * hour}
        historyStart={start}
        lanes={[]}
        onSeek={(time) => seeks.push((time - start) / hour)}
        step={15 * 60_000}
        to={start + to * hour}
        uses24HourClock
        valueLabel="00:00"
      />,
    ),
  );
  const track = root.container.queryAll(
    (node) => node.type === "view" && node.props["accessibilityLabel"] === "Time of day",
  )[0];
  const onLayout = track?.props["onLayout"] as
    ((event: { nativeEvent: { layout: { width: number } } }) => void) | undefined;
  await act(async () => onLayout?.({ nativeEvent: { layout: { width: 240 } } }));
  const detector = root.container.queryAll((node) => node.type === "gesture-detector")[0];
  const { handlers } = (detector?.props["gesture"] ?? { handlers: {} }) as {
    handlers: TestGestureHandlers;
  };
  return {
    act: (name: string, x?: number) => handlers[name]?.(x === undefined ? {} : { x }),
    events,
    hours: () => (clock.time.value - start) / hour,
    seeks,
    accessibilityAction: (actionName: string) =>
      (track?.props["onAccessibilityAction"] as ((event: object) => void) | undefined)?.({
        nativeEvent: { actionName },
      }),
    unmount: () => act(async () => root.unmount()),
  };
};

test("touching the track jumps to that time and dragging follows the finger", async () => {
  const track = await renderTrack({ from: 0, to: 24 });
  track.act("onBegin", 40);
  expect(track.hours()).toBe(4);
  track.act("onUpdate", 100);
  expect(track.hours()).toBe(10);
  track.act("onFinalize");
  expect(track.events).toEqual(["begin", "end 10"]);
  await track.unmount();
});

test("dragging past the shown hours stops at the first and last available moment", async () => {
  const track = await renderTrack({ from: 2, to: 18 });
  track.act("onBegin", 0);
  expect(track.hours()).toBe(2);
  track.act("onUpdate", 400);
  expect(track.hours()).toBe(18);
  await track.unmount();
});

test("screen reader adjustments move by one step and stay inside the shown hours", async () => {
  const track = await renderTrack({ from: 0, to: 24 });
  track.accessibilityAction("increment");
  track.accessibilityAction("decrement");
  expect(track.seeks).toEqual([0.25, 0]);
  await track.unmount();
});

const keyLabels = async (showNotAvailable: boolean, showDrives = false) => {
  const root = createRoot();
  await act(async () =>
    root.render(<TimelineKey showDrives={showDrives} showNotAvailable={showNotAvailable} />),
  );
  const labels = root.container
    .queryAll((node) => node.type === "text")
    .map((node) => node.children.join(""));
  await act(async () => root.unmount());
  return labels;
};

test("the key only lists Not available when the day has unavailable time", async () => {
  expect(await keyLabels(false)).toEqual(["Moving", "Stopped", "Paused", "No location"]);
  expect(await keyLabels(true)).toEqual([
    "Moving",
    "Stopped",
    "Paused",
    "No location",
    "Not available",
  ]);
});

test("the key lists Drive and Passenger when the lanes show drives", async () => {
  expect(await keyLabels(false, true)).toEqual([
    "Moving",
    "Stopped",
    "Paused",
    "No location",
    "Drive",
    "Passenger",
  ]);
});
