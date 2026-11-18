import { memo, useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";
import type { TimelineSegment } from "../../lib/timelineTypes.ts";
import { useColors } from "../../lib/theme.ts";
import { Text } from "../ui/Text.tsx";

const LANE_HEIGHT = 16;
const LANE_GAP = 8;
const AVATAR_WIDTH = 30;

type Lane = {
  color: string;
  id: string;
  initials: string;
  runs: ReadonlyArray<{
    end: number;
    kind: TimelineSegment["kind"];
    start: number;
  }>;
};

export const TimelineScrubber = ({
  day,
  from,
  historyStart,
  lanes,
  onScrub,
  time,
  timeLabel,
  to,
}: {
  day: { end: number; start: number };
  from: number;
  historyStart: number;
  lanes: readonly Lane[];
  onScrub: (time: number) => void;
  time: number;
  timeLabel: string;
  to: number;
}) => {
  const [width, setWidth] = useState(0);
  const span = day.end - day.start;
  const xOf = (value: number) => ((value - day.start) / span) * width;
  const latest = useRef({ day, from, onScrub, span, to, width });
  latest.current = { day, from, onScrub, span, to, width };
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => scrubTo(event.nativeEvent.locationX),
      onPanResponderMove: (event) => scrubTo(event.nativeEvent.locationX),
    }),
  ).current;
  const scrubTo = (x: number) => {
    const current = latest.current;
    if (current.width <= 0) return;
    const value = current.day.start + (x / current.width) * current.span;
    current.onScrub(Math.min(Math.max(value, current.from), current.to));
  };
  const height = lanes.length * (LANE_HEIGHT + LANE_GAP) - LANE_GAP;
  const date = new Date(day.start);
  const ticks = [0, 6, 12, 18, 24].map((hour) => ({
    hour,
    at: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime(),
  }));

  return (
    <View>
      <View className="flex-row">
        <View style={{ width: AVATAR_WIDTH, gap: LANE_GAP }}>
          {lanes.map((lane) => (
            <View
              key={lane.id}
              className="items-center justify-center rounded-full"
              style={{
                width: 22,
                height: LANE_HEIGHT + 2,
                backgroundColor: lane.color,
              }}
            >
              <Text className="text-[9px] font-bold leading-[11px] text-white">
                {lane.initials}
              </Text>
            </View>
          ))}
        </View>
        <View
          className="flex-1"
          style={{ height: height + 12, paddingTop: 6 }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Time of day"
          accessibilityValue={{ text: timeLabel }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const step = event.nativeEvent.actionName === "increment" ? 15 * 60_000 : -15 * 60_000;
            onScrub(Math.min(Math.max(time + step, from), to));
          }}
          {...panResponder.panHandlers}
        >
          {width > 0 ? (
            <View pointerEvents="none">
              <TimelineLanes
                day={day}
                height={height}
                historyStart={historyStart}
                lanes={lanes}
                width={width}
              />
              <View
                className="absolute bg-foreground"
                style={{
                  left: xOf(time) - 1,
                  top: -6,
                  width: 2,
                  height: height + 12,
                }}
              />
              <View
                className="absolute rounded-full border-2 border-card bg-foreground"
                style={{ left: xOf(time) - 7, top: -10, width: 14, height: 14 }}
              />
            </View>
          ) : null}
        </View>
      </View>
      <View className="flex-row" style={{ marginLeft: AVATAR_WIDTH, height: 16 }}>
        {width > 0
          ? ticks.map((tick) => (
              <Text
                key={tick.hour}
                className="absolute text-[11px] text-muted"
                style={{
                  left: Math.min(Math.max(xOf(tick.at) - 8, 0), width - 16),
                  width: 16,
                  textAlign: "center",
                }}
              >
                {String(tick.hour).padStart(2, "0")}
              </Text>
            ))
          : null}
      </View>
    </View>
  );
};

const TimelineLanes = memo(
  ({
    day,
    height,
    historyStart,
    lanes,
    width,
  }: {
    day: { end: number; start: number };
    height: number;
    historyStart: number;
    lanes: readonly Lane[];
    width: number;
  }) => {
    const colors = useColors();
    const span = day.end - day.start;
    const xOf = (value: number) => ((value - day.start) / span) * width;
    const shadedWidth = Math.max(0, Math.min(xOf(historyStart), width));
    return (
      <Svg width={width} height={height}>
        <Defs>
          <Pattern
            id="timeline-hatch"
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <Rect width={6} height={6} fill={colors.isDark ? "#1E1830" : "#EEEAF4"} />
            <Line x1={0} y1={0} x2={0} y2={6} stroke={colors.textMuted} strokeWidth={2} />
          </Pattern>
        </Defs>
        {lanes.map((lane, index) => {
          const y = index * (LANE_HEIGHT + LANE_GAP);
          return lane.runs.map((run) => {
            const x = xOf(run.start);
            const runWidth = Math.max(xOf(run.end) - x, 1);
            const key = `${lane.id}:${run.start}`;
            if (run.kind === "pause") {
              return (
                <Rect
                  key={key}
                  x={x + 0.75}
                  y={y + 0.75}
                  width={Math.max(runWidth - 1.5, 0.5)}
                  height={LANE_HEIGHT - 1.5}
                  fill="none"
                  stroke={colors.textSecondary}
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                />
              );
            }
            return (
              <Rect
                key={key}
                x={x}
                y={y}
                width={runWidth}
                height={LANE_HEIGHT}
                fill={run.kind === "noLocation" ? "url(#timeline-hatch)" : lane.color}
                opacity={run.kind === "stay" ? 0.3 : run.kind === "noLocation" ? 0.6 : 1}
              />
            );
          });
        })}
        {shadedWidth > 0 ? (
          <Rect x={0} y={0} width={shadedWidth} height={height} fill="url(#timeline-hatch)" />
        ) : null}
      </Svg>
    );
  },
);
