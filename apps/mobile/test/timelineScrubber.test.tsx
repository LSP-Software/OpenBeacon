import { expect, mock, test } from "bun:test";
import React, { act, type ReactNode } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const element =
  (type: string) =>
  ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement(type, props, children);

let fontScale = 1;
mock.module("react-native", () => ({
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ fontScale }),
  View: element("view"),
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
      lanes={[]}
      onScrub={() => {}}
      step={15 * 60_000}
      time={start}
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
            runs: [{ end: start + 6 * hour, kind: "noLocation", start: start + 5 * hour }],
          },
        ]}
        onScrub={() => {}}
        step={15 * 60_000}
        time={start + 2 * hour}
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

const keyLabels = async (showNotAvailable: boolean) => {
  const root = createRoot();
  await act(async () => root.render(<TimelineKey showNotAvailable={showNotAvailable} />));
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
