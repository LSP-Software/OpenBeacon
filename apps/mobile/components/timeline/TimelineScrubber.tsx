import { memo, useLayoutEffect, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  PanResponder,
  View,
} from "react-native";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";
import { formatTimelineHourTick } from "../../lib/timelineClock.ts";
import type { TimelineSegment } from "../../lib/timelineTypes.ts";
import { useColors } from "../../lib/theme.ts";
import { Text } from "../ui/Text.tsx";

const LANE_HEIGHT = 16;
const STOPPED_HEIGHT = 8;
const KNOB_SIZE = 20;
const LANE_GAP = 8;
const AVATAR_WIDTH = 30;

type Lane = {
  color: string;
  historyStart: number;
  id: string;
  initials: string;
  runs: ReadonlyArray<{
    end: number;
    kind: TimelineSegment["kind"];
    start: number;
  }>;
};

type Scrub = {
  day: { end: number; start: number };
  from: number;
  onScrub: (time: number) => void;
  step: number;
  time: number;
  to: number;
  valueLabel: string;
};

export const TimelineScrubber = ({
  historyStart,
  lanes,
  uses24HourClock,
  ...scrub
}: Scrub & {
  historyStart: number;
  lanes: readonly Lane[];
  uses24HourClock: boolean;
}) => {
  const { day, time } = scrub;
  const { trackProps, width, xOf } = useScrubTrack(scrub);
  const height = lanes.length * (LANE_HEIGHT + LANE_GAP) - LANE_GAP;
  const date = new Date(day.start);
  const ticks = [0, 6, 12, 18, 24].map((hour) => ({
    hour,
    at: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime(),
  }));
  const tickWidth = uses24HourClock ? 16 : 40;

  return (
    <View>
      <View className="flex-row">
        <View style={{ width: AVATAR_WIDTH, gap: LANE_GAP - 2, paddingTop: KNOB_SIZE / 2 + 5 }}>
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
          style={{ minHeight: 44, paddingBottom: 8, paddingTop: KNOB_SIZE / 2 + 6 }}
          {...trackProps}
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
                style={{
                  left: xOf(time) - KNOB_SIZE / 2,
                  top: -6 - KNOB_SIZE / 2,
                  width: KNOB_SIZE,
                  height: KNOB_SIZE,
                }}
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
                className="absolute text-xs text-secondary"
                style={{
                  left: Math.min(Math.max(xOf(tick.at) - tickWidth / 2, 0), width - tickWidth),
                  width: tickWidth,
                  textAlign: "center",
                }}
              >
                {formatTimelineHourTick(tick.hour, uses24HourClock)}
              </Text>
            ))
          : null}
      </View>
    </View>
  );
};

export const TimelineMiniScrubber = (scrub: Scrub) => {
  const { trackProps, width, xOf } = useScrubTrack(scrub);
  const x = xOf(scrub.time);
  return (
    <View className="h-6 justify-center" {...trackProps}>
      {width > 0 ? (
        <View pointerEvents="none">
          <View className="h-[3px] rounded-full bg-border" />
          <View className="absolute h-[3px] rounded-full bg-foreground" style={{ width: x }} />
          <View
            className="absolute rounded-full border-2 border-card bg-foreground"
            style={{ left: x - 7, top: -5.5, width: 14, height: 14 }}
          />
        </View>
      ) : null}
    </View>
  );
};

const useScrubTrack = ({ day, from, onScrub, step, time, to, valueLabel }: Scrub) => {
  const [width, setWidth] = useState(0);
  const latest = useRef({ day, from, onScrub, to, width });
  useLayoutEffect(() => {
    latest.current = { day, from, onScrub, to, width };
  });
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
    const value = current.day.start + (x / current.width) * (current.day.end - current.day.start);
    current.onScrub(Math.min(Math.max(value, current.from), current.to));
  };
  return {
    trackProps: {
      onLayout: (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
      accessible: true,
      accessibilityRole: "adjustable" as const,
      accessibilityLabel: "Time of day",
      accessibilityValue: { text: valueLabel },
      accessibilityActions: [{ name: "increment" }, { name: "decrement" }],
      onAccessibilityAction: (event: AccessibilityActionEvent) => {
        const change = event.nativeEvent.actionName === "increment" ? step : -step;
        onScrub(Math.min(Math.max(time + change, from), to));
      },
      ...panResponder.panHandlers,
    },
    width,
    xOf: (value: number) => ((value - day.start) / (day.end - day.start)) * width,
  };
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
    const span = day.end - day.start;
    const xOf = (value: number) => ((value - day.start) / span) * width;
    const shadedWidth = Math.max(0, Math.min(xOf(historyStart), width));
    return (
      <Svg width={width} height={height}>
        <HatchPattern />
        {lanes.map((lane, index) => {
          const y = index * (LANE_HEIGHT + LANE_GAP);
          const laneShaded = Math.min(xOf(lane.historyStart), width) - shadedWidth;
          return [
            ...(laneShaded > 0
              ? [
                  <UnavailableShape
                    key={`${lane.id}:shaded`}
                    height={LANE_HEIGHT}
                    width={laneShaded}
                    x={shadedWidth}
                    y={y}
                  />,
                ]
              : []),
            ...lane.runs.map((run) => {
              const x = xOf(run.start);
              const runWidth = Math.max(xOf(run.end) - x, 1);
              return (
                <RunShape
                  key={`${lane.id}:${run.start}`}
                  color={lane.color}
                  kind={run.kind}
                  width={runWidth}
                  x={x}
                  y={y}
                />
              );
            }),
          ];
        })}
        {shadedWidth > 0 ? (
          <UnavailableShape height={height} width={shadedWidth} x={0} y={0} />
        ) : null}
      </Svg>
    );
  },
);

const HatchPattern = () => {
  const colors = useColors();
  return (
    <Defs>
      <Pattern
        id="timeline-hatch"
        width={6}
        height={6}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <Rect width={6} height={6} fill={colors.background} />
        <Line x1={0} y1={0} x2={0} y2={6} stroke={colors.textMuted} strokeWidth={2} />
      </Pattern>
    </Defs>
  );
};

const UnavailableShape = ({
  height,
  width,
  x,
  y,
}: {
  height: number;
  width: number;
  x: number;
  y: number;
}) => {
  const colors = useColors();
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={colors.textMuted}
      opacity={colors.isDark ? 0.28 : 0.18}
    />
  );
};

const RunShape = ({
  color,
  kind,
  width,
  x,
  y,
}: {
  color: string;
  kind: TimelineSegment["kind"];
  width: number;
  x: number;
  y: number;
}) => {
  const colors = useColors();
  if (kind === "pause") {
    return (
      <Rect
        x={x + 0.75}
        y={y + 0.75}
        width={Math.max(width - 1.5, 0.5)}
        height={LANE_HEIGHT - 1.5}
        fill="none"
        stroke={colors.textSecondary}
        strokeWidth={1.5}
        strokeDasharray="2 2"
      />
    );
  }
  if (kind === "stay") {
    return (
      <Rect
        x={x}
        y={y + (LANE_HEIGHT - STOPPED_HEIGHT) / 2}
        width={width}
        height={STOPPED_HEIGHT}
        fill={color}
        opacity={0.45}
      />
    );
  }
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={LANE_HEIGHT}
      fill={kind === "noLocation" ? "url(#timeline-hatch)" : color}
      opacity={kind === "noLocation" ? 0.6 : 1}
    />
  );
};

export const TimelineKey = ({
  color,
  showNotAvailable,
}: {
  color?: string | undefined;
  showNotAvailable: boolean;
}) => {
  const colors = useColors();
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1">
      {(
        [
          { kind: "moving", label: "Moving" },
          { kind: "stay", label: "Stopped" },
          { kind: "pause", label: "Paused" },
          { kind: "noLocation", label: "No location" },
        ] as const
      ).map((item) => (
        <View key={item.kind} className="flex-row items-center gap-1.5">
          <Svg width={18} height={LANE_HEIGHT}>
            <HatchPattern />
            <RunShape color={color ?? colors.text} kind={item.kind} width={18} x={0} y={0} />
          </Svg>
          <Text className="text-xs text-secondary">{item.label}</Text>
        </View>
      ))}
      {showNotAvailable ? (
        <View className="flex-row items-center gap-1.5">
          <Svg width={18} height={LANE_HEIGHT}>
            <UnavailableShape height={LANE_HEIGHT} width={18} x={0} y={0} />
          </Svg>
          <Text className="text-xs text-secondary">Not available</Text>
        </View>
      ) : null}
    </View>
  );
};
