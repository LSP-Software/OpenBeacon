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

mock.module("react-native", () => ({
  PanResponder: { create: () => ({ panHandlers: {} }) },
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

const { TimelineScrubber } = await import("../components/timeline/TimelineScrubber.tsx");

const ticksFor = async (uses24HourClock: boolean) => {
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
  await act(async () => onLayout?.({ nativeEvent: { layout: { width: 320 } } }));
  const ticks = root.container
    .queryAll(
      (node) =>
        node.type === "text" && node.props["className"] === "absolute text-xs text-secondary",
    )
    .map((node) => String(node.children.join("")).replace(/\s/g, " "));
  await act(async () => root.unmount());
  return ticks;
};

test("the scrubber's hour marks follow the phone's 12 or 24-hour clock", async () => {
  expect(await ticksFor(true)).toEqual(["00", "06", "12", "18", "24"]);
  expect(await ticksFor(false)).toEqual(["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"]);
});
