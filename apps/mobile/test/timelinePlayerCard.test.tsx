import { expect, mock, test } from "bun:test";
import React, { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const element =
  (type: string) =>
  ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement(type, props, children);

mock.module("react-native", () => ({
  Pressable: element("pressable"),
  View: element("view"),
}));
mock.module("react-native-reanimated", () => ({
  default: { View: element("animated-view") },
}));
mock.module("../components/ui/Text.tsx", () => ({ Text: element("text") }));

const { TimelinePlayerCard } = await import("../components/timeline/TimelinePlayerCard.tsx");

const card = {
  collapsible: true,
  measure: () => () => {},
  miniSlots: { clock: {}, play: {}, speed: {} },
  open: false,
  panHandlers: {},
  setExpanded: () => {},
} as unknown as ComponentProps<typeof TimelinePlayerCard>["card"];

const miniLine = async (miniStatus: ComponentProps<typeof TimelinePlayerCard>["miniStatus"]) => {
  const root = createRoot();
  await act(async () =>
    root.render(
      <TimelinePlayerCard bottom={0} card={card} miniScrubber={null} miniStatus={miniStatus}>
        {null}
      </TimelinePlayerCard>,
    ),
  );
  const texts = root.container.queryAll((node) => node.type === "text");
  const line = {
    announced: texts
      .filter((node) => node.props["accessibilityLiveRegion"] === "polite")
      .map((node) => node.children.join(""))
      .join(""),
    shown: texts.map((node) => node.children.join("")).join(""),
  };
  await act(async () => root.unmount());
  return line;
};

test("the mini player shows the speed while moving but only announces the status and date", async () => {
  expect(await miniLine({ date: "Sat 21 Nov", speed: "43 km/h", title: "Moving" })).toEqual({
    announced: "Moving · Sat 21 Nov",
    shown: "Moving · 43 km/h · Sat 21 Nov",
  });
});

test("the mini player shows just the date when there is no status", async () => {
  expect(await miniLine({ date: "Sat 21 Nov", speed: null, title: null })).toEqual({
    announced: "Sat 21 Nov",
    shown: "Sat 21 Nov",
  });
});
