import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, PanResponder, Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { timelineCardOpens } from "../../lib/timelineCard.ts";
import { Text } from "../ui/Text.tsx";

const HANDLE_HEIGHT = 20;
const MINI_ROW = 48;
const MINI_CLOCK_LEFT = MINI_ROW + 12;
const MINI_CLOCK_SCALE = 0.8;
const MINI_LINE_TOP = 50;
const MINI_HEIGHT = HANDLE_HEIGHT + MINI_LINE_TOP + 24 + 10;
const TAP_SLOP = 6;

type Box = { height: number; width: number; x: number; y: number };
type Shift = { scale: number; x: number; y: number };

export const useTimelinePlayerCard = ({
  canCollapse,
  reduceMotion,
}: {
  canCollapse: boolean;
  reduceMotion: boolean;
}) => {
  const [expanded, setExpanded] = useState(true);
  const [fullHeight, setFullHeight] = useState(0);
  const [boxes, setBoxes] = useState<
    Partial<Record<"clock" | "controls" | "play" | "speed" | "topRow", Box>>
  >({});
  const open = expanded || !canCollapse;
  const progress = useSharedValue(1);
  const target = useRef(true);
  const dragStart = useRef(1);

  const settle = (opened: boolean, velocity = 0) => {
    target.current = opened;
    progress.value = reduceMotion
      ? Number(opened)
      : withSpring(Number(opened), { damping: 26, stiffness: 260, velocity });
  };

  useEffect(() => {
    if (target.current !== open) settle(open);
  });

  const latest = useRef({ canCollapse, open, range: fullHeight - MINI_HEIGHT, settle });
  useLayoutEffect(() => {
    latest.current = { canCollapse, open, range: fullHeight - MINI_HEIGHT, settle };
  });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.canCollapse && !latest.current.open,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        latest.current.canCollapse &&
        Math.abs(gesture.dy) > TAP_SLOP &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        cancelAnimation(progress);
        dragStart.current = progress.value;
      },
      onPanResponderMove: (_event, gesture) => {
        const range = Math.max(latest.current.range, 1);
        progress.value = Math.min(Math.max(dragStart.current - gesture.dy / range, 0), 1);
      },
      onPanResponderRelease: (_event, gesture) => {
        const tapped = Math.abs(gesture.dx) < TAP_SLOP && Math.abs(gesture.dy) < TAP_SLOP;
        const opened =
          tapped || timelineCardOpens({ progress: progress.value, velocity: gesture.vy });
        latest.current.settle(opened, (-gesture.vy * 1000) / Math.max(latest.current.range, 1));
        setExpanded(opened);
      },
      onPanResponderTerminate: () => latest.current.settle(latest.current.open),
    }),
  ).current;

  const measure = (name: keyof typeof boxes) => (event: LayoutChangeEvent) => {
    const { height, width, x, y } = event.nativeEvent.layout;
    setBoxes((current) => {
      const box = current[name];
      if (box?.height === height && box.width === width && box.x === x && box.y === y) {
        return current;
      }
      return { ...current, [name]: { height, width, x, y } };
    });
  };
  const shiftTo = (
    box: Box | undefined,
    row: Box | undefined,
    mini: (box: Box) => { centerX: number; centerY: number; scale: number },
  ): Shift => {
    if (!box || !row) return { scale: 1, x: 0, y: 0 };
    const { centerX, centerY, scale } = mini(box);
    return {
      scale,
      x: centerX - (row.x + box.x + box.width / 2),
      y: centerY - (row.y + box.y + box.height / 2),
    };
  };
  const clockShift = shiftTo(boxes.clock, boxes.topRow, (box) => ({
    centerX: MINI_CLOCK_LEFT + (box.width * MINI_CLOCK_SCALE) / 2,
    centerY: (box.height * MINI_CLOCK_SCALE) / 2,
    scale: MINI_CLOCK_SCALE,
  }));
  const playShift = shiftTo(boxes.play, boxes.controls, (box) => ({
    centerX: MINI_ROW / 2,
    centerY: MINI_ROW / 2,
    scale: MINI_ROW / box.width,
  }));
  const speedShift = shiftTo(boxes.speed, boxes.topRow, (box) => ({
    centerX: (boxes.topRow?.width ?? 0) - box.width / 2,
    centerY: MINI_ROW / 2,
    scale: 1,
  }));

  const clockStyle = useAnimatedStyle(() => sharedMotion(progress.value, clockShift));
  const playStyle = useAnimatedStyle(() => sharedMotion(progress.value, playShift));
  const speedStyle = useAnimatedStyle(() => sharedMotion(progress.value, speedShift));
  const heightStyle = useAnimatedStyle(() => ({
    height: MINI_HEIGHT + (fullHeight - MINI_HEIGHT) * progress.value,
  }));
  const fullOnlyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const miniOnlyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  return {
    canCollapse,
    fullOnly: {
      accessibilityElementsHidden: !open,
      importantForAccessibility: open ? ("auto" as const) : ("no-hide-descendants" as const),
      pointerEvents: open ? ("auto" as const) : ("none" as const),
      style: fullOnlyStyle,
    },
    height: fullHeight === 0 ? 0 : open ? fullHeight : MINI_HEIGHT,
    heightStyle,
    measure,
    miniOnly: {
      accessibilityElementsHidden: open,
      importantForAccessibility: open ? ("no-hide-descendants" as const) : ("auto" as const),
      pointerEvents: open ? ("none" as const) : ("box-none" as const),
      style: miniOnlyStyle,
    },
    onFullLayout: (event: LayoutChangeEvent) => setFullHeight(event.nativeEvent.layout.height),
    open,
    panHandlers: panResponder.panHandlers,
    setExpanded,
    shared: {
      clock: { onLayout: measure("clock"), style: clockStyle },
      play: { onLayout: measure("play"), style: playStyle },
      speed: { onLayout: measure("speed"), style: speedStyle },
    },
  };
};

type PlayerCard = ReturnType<typeof useTimelinePlayerCard>;

export const TimelineCardShared = ({
  children,
  motion,
}: {
  children: ReactNode;
  motion: PlayerCard["shared"]["clock"];
}) => (
  <View onLayout={motion.onLayout}>
    <Animated.View style={motion.style}>{children}</Animated.View>
  </View>
);

export const TimelinePlayerCard = ({
  bottom,
  card,
  children,
  miniDate,
  miniScrubber,
}: {
  bottom: number;
  card: PlayerCard;
  children: ReactNode;
  miniDate: string;
  miniScrubber: ReactNode;
}) => (
  <View
    className="absolute left-3 right-3 rounded-2xl border border-border bg-card shadow-md shadow-black/15"
    style={{ bottom }}
    {...card.panHandlers}
  >
    <Animated.View className="overflow-hidden rounded-2xl" style={card.heightStyle}>
      <View
        className={card.canCollapse ? "px-4 pb-3" : "px-4 pb-3 pt-3"}
        onLayout={card.onFullLayout}
      >
        {card.canCollapse ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={card.open ? "Collapse player" : "Expand player"}
            accessibilityState={{ expanded: card.open }}
            onPress={() => card.setExpanded(!card.open)}
            className="items-center justify-center"
            style={{ height: HANDLE_HEIGHT }}
          >
            <View className="h-1 w-9 rounded-full bg-border-strong" />
          </Pressable>
        ) : null}
        {children}
      </View>
      {card.canCollapse ? (
        <Animated.View
          {...card.miniOnly}
          className="absolute inset-x-0 top-0 px-4"
          style={[card.miniOnly.style, { paddingTop: HANDLE_HEIGHT }]}
        >
          <Text
            pointerEvents="none"
            className="text-xs text-secondary"
            numberOfLines={1}
            style={{ marginLeft: MINI_CLOCK_LEFT, marginTop: 30 }}
          >
            {miniDate}
          </Text>
          <View className="absolute inset-x-4" style={{ top: HANDLE_HEIGHT + MINI_LINE_TOP }}>
            {miniScrubber}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  </View>
);

const sharedMotion = (progress: number, shift: Shift) => {
  "worklet";
  const rest = 1 - progress;
  return {
    left: shift.x * rest,
    top: shift.y * rest,
    transform: [{ scale: 1 + (shift.scale - 1) * rest }],
  };
};
