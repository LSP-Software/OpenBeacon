import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, PanResponder } from "react-native";
import {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { type TimelineCardBox, timelineCardOpens, timelineCardShift } from "../lib/timelineCard.ts";

export const HANDLE_HEIGHT = 20;
const MINI_ROW = 48;
export const MINI_CLOCK_LEFT = MINI_ROW + 12;
const MINI_CLOCK_SCALE = 0.8;
export const MINI_LINE_TOP = 50;
const MINI_HEIGHT = HANDLE_HEIGHT + MINI_LINE_TOP + 24 + 10;
const TAP_SLOP = 6;

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
    Partial<Record<"clock" | "controls" | "play" | "speed" | "topRow", TimelineCardBox>>
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
  const clockShift = timelineCardShift({
    from: [boxes.topRow, boxes.clock],
    to: [
      boxes.clock && {
        height: boxes.clock.height * MINI_CLOCK_SCALE,
        width: boxes.clock.width * MINI_CLOCK_SCALE,
        x: MINI_CLOCK_LEFT,
        y: 0,
      },
    ],
  });
  const playShift = timelineCardShift({
    from: [boxes.controls, boxes.play],
    to: [{ height: MINI_ROW, width: MINI_ROW, x: 0, y: 0 }],
  });
  const speedShift = timelineCardShift({
    from: [boxes.topRow, boxes.speed],
    to: [
      boxes.speed && {
        ...boxes.speed,
        x: (boxes.topRow?.width ?? 0) - boxes.speed.width,
        y: (MINI_ROW - boxes.speed.height) / 2,
      },
    ],
  });

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

const sharedMotion = (progress: number, shift: { scale: number; x: number; y: number }) => {
  "worklet";
  const rest = 1 - progress;
  return {
    left: shift.x * rest,
    top: shift.y * rest,
    transform: [{ scale: 1 + (shift.scale - 1) * rest }],
  };
};
