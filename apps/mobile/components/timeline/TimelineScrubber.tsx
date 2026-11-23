import { memo, useState } from "react";
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";
import { formatTimelineHourTick, timelineHourTicks } from "../../lib/timelineClock.ts";
import type { TimelineSegment } from "../../lib/timelineTypes.ts";
import { useColors } from "../../lib/theme.ts";
import { Text } from "../ui/Text.tsx";

const LANE_HEIGHT = 16;
const STOPPED_HEIGHT = 8;
const KNOB_SIZE = 20;
const MINI_KNOB_SIZE = 14;
const LANE_GAP = 8;
const AVATAR_WIDTH = 30;
const TICK_MAX_FONT_SCALE = 2;

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
  clock: {
    onBegin: () => void;
    onEnd: (time: number) => void;
    time: SharedValue<number>;
  };
  day: { end: number; start: number };
  from: number;
  onSeek: (time: number) => void;
  step: number;
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
  const { day } = scrub;
  const { gesture, trackProps, width, x } = useScrubTrack(scrub);
  const height = lanes.length * (LANE_HEIGHT + LANE_GAP) - LANE_GAP;
  const date = new Date(day.start);
  const tickScale = Math.min(useWindowDimensions().fontScale, TICK_MAX_FONT_SCALE);
  const tickWidth = Math.ceil((uses24HourClock ? 16 : 40) * tickScale);
  const ticks = timelineHourTicks({ labelWidth: tickWidth, trackWidth: width }).map((hour) => ({
    hour,
    at: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime(),
  }));
  const xOf = (value: number) => ((value - day.start) / (day.end - day.start)) * width;
  const handleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

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
        <GestureDetector gesture={gesture}>
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
                <Animated.View
                  className="absolute left-0"
                  style={[{ top: -6 - KNOB_SIZE / 2, width: 0 }, handleStyle]}
                >
                  <View
                    className="absolute bg-foreground"
                    style={{ left: -1, top: KNOB_SIZE / 2, width: 2, height: height + 12 }}
                  />
                  <View
                    className="absolute rounded-full border-2 border-card bg-foreground"
                    style={{ left: -KNOB_SIZE / 2, width: KNOB_SIZE, height: KNOB_SIZE }}
                  />
                </Animated.View>
              </View>
            ) : null}
          </View>
        </GestureDetector>
      </View>
      <View
        className="flex-row"
        style={{ marginLeft: AVATAR_WIDTH, height: Math.ceil(16 * tickScale) }}
      >
        {width > 0
          ? ticks.map((tick) => (
              <Text
                key={tick.hour}
                className="absolute text-xs text-secondary"
                maxFontSizeMultiplier={TICK_MAX_FONT_SCALE}
                numberOfLines={1}
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
  const { gesture, trackProps, width, x } = useScrubTrack(scrub);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - width }] }));
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <View className="h-11 justify-center" {...trackProps}>
        {width > 0 ? (
          <View pointerEvents="none">
            <View className="h-[3px] overflow-hidden rounded-full bg-border">
              <Animated.View
                className="h-[3px] rounded-full bg-foreground"
                style={[{ width }, fillStyle]}
              />
            </View>
            <Animated.View
              className="absolute rounded-full border-2 border-card bg-foreground"
              style={[
                {
                  left: -MINI_KNOB_SIZE / 2,
                  top: -(MINI_KNOB_SIZE - 3) / 2,
                  width: MINI_KNOB_SIZE,
                  height: MINI_KNOB_SIZE,
                },
                knobStyle,
              ]}
            />
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
};

const useScrubTrack = ({ clock, day, from, onSeek, step, to, valueLabel }: Scrub) => {
  const [width, setWidth] = useState(0);
  const trackWidth = useSharedValue(0);
  const { time } = clock;
  const dayStart = day.start;
  const span = day.end - day.start;
  const x = useDerivedValue(() => ((time.value - dayStart) / span) * trackWidth.value);
  const timeAt = (position: number) => {
    "worklet";
    if (trackWidth.value <= 0) return time.value;
    return Math.min(Math.max(dayStart + (position / trackWidth.value) * span, from), to);
  };
  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      clock.onBegin();
      time.value = timeAt(event.x);
    })
    .onUpdate((event) => {
      time.value = timeAt(event.x);
    })
    .onFinalize(() => {
      clock.onEnd(time.value);
    });
  return {
    gesture,
    trackProps: {
      onLayout: (event: LayoutChangeEvent) => {
        setWidth(event.nativeEvent.layout.width);
        trackWidth.value = event.nativeEvent.layout.width;
      },
      accessible: true,
      accessibilityRole: "adjustable" as const,
      accessibilityLabel: "Time of day",
      accessibilityValue: { text: valueLabel },
      accessibilityActions: [{ name: "increment" }, { name: "decrement" }],
      onAccessibilityAction: (event: AccessibilityActionEvent) => {
        const change = event.nativeEvent.actionName === "increment" ? step : -step;
        onSeek(Math.min(Math.max(time.value + change, from), to));
      },
    },
    width,
    x,
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
