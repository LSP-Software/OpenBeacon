import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, PanResponder } from "react-native";
import {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import {
  type TimelineCardBox,
  timelineCardBoxMoved,
  timelineCardIsOpen,
  timelineCardOpens,
  timelineCardShift,
  timelineMiniClockScale,
} from "../lib/timelineCard.ts";

const MINI_PLAY_SIZE = 48;
const TAP_SLOP = 6;

type BoxName =
  | "clock"
  | "content"
  | "controls"
  | "miniClock"
  | "miniColumn"
  | "miniPlay"
  | "miniRow"
  | "miniSpeed"
  | "play"
  | "speed"
  | "topRow";

export const useTimelinePlayerCard = ({
  canCollapse,
  loading,
  reduceMotion,
}: {
  canCollapse: boolean;
  loading: boolean;
  reduceMotion: boolean;
}) => {
  const [expanded, setExpanded] = useState(true);
  const [heights, setHeights] = useState({ full: 0, mini: 0 });
  const [boxes, setBoxes] = useState<Partial<Record<BoxName, TimelineCardBox>>>({});
  const open = timelineCardIsOpen({ canCollapse, expanded, loading });
  const collapsible = canCollapse || !open;
  const progress = useSharedValue(1);
  const restingOpen = useSharedValue(true);
  const target = useRef(true);
  const dragStart = useRef(1);
  const range = heights.full - heights.mini;

  const settle = (opened: boolean, velocity = 0) => {
    target.current = opened;
    if (reduceMotion) {
      progress.value = Number(opened);
      restingOpen.value = opened;
      return;
    }
    restingOpen.value = false;
    progress.value = withSpring(
      Number(opened),
      { damping: 26, overshootClamping: true, stiffness: 260, velocity },
      (finished) => {
        if (finished && opened) restingOpen.value = true;
      },
    );
  };

  useEffect(() => {
    if (target.current !== open) settle(open);
  });

  const latest = useRef({ collapsible, open, range, settle });
  useLayoutEffect(() => {
    latest.current = { collapsible, open, range, settle };
  });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.open,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        latest.current.collapsible &&
        Math.abs(gesture.dy) > TAP_SLOP &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        cancelAnimation(progress);
        restingOpen.value = false;
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

  const measure = (name: BoxName) => (event: LayoutChangeEvent) => {
    const { height, width, x, y } = event.nativeEvent.layout;
    const next = { height, width, x, y };
    setBoxes((current) =>
      timelineCardBoxMoved(current[name], next) ? { ...current, [name]: next } : current,
    );
  };
  const measureHeight = (name: "full" | "mini") => (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    setHeights((current) => (current[name] === height ? current : { ...current, [name]: height }));
  };

  const clockScale = timelineMiniClockScale({
    available: boxes.miniColumn?.width ?? 0,
    width: boxes.clock?.width ?? 0,
  });
  const shifts = useMemo(
    () => ({
      clock: timelineCardShift({
        from: [boxes.content, boxes.topRow, boxes.clock],
        to: [boxes.miniRow, boxes.miniColumn, boxes.miniClock],
      }),
      play: timelineCardShift({
        from: [boxes.content, boxes.controls, boxes.play],
        to: [boxes.miniRow, boxes.miniPlay],
      }),
      speed: timelineCardShift({
        from: [boxes.content, boxes.topRow, boxes.speed],
        to: [boxes.miniRow, boxes.miniSpeed],
      }),
    }),
    [boxes],
  );

  const clockStyle = useAnimatedStyle(() => sharedMotion(progress.value, shifts.clock));
  const playStyle = useAnimatedStyle(() => sharedMotion(progress.value, shifts.play));
  const speedStyle = useAnimatedStyle(() => sharedMotion(progress.value, shifts.speed));
  const heightStyle = useAnimatedStyle(() => ({
    height: restingOpen.value
      ? ("auto" as const)
      : heights.mini + (heights.full - heights.mini) * clampProgress(progress.value),
  }));
  const fullOnlyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const miniOnlyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  return {
    collapse: () => {
      if (canCollapse) setExpanded(false);
    },
    collapsible,
    fullOnly: {
      accessibilityElementsHidden: !open,
      importantForAccessibility: open ? ("auto" as const) : ("no-hide-descendants" as const),
      pointerEvents: open ? ("auto" as const) : ("none" as const),
      style: fullOnlyStyle,
    },
    height: heights.full === 0 ? 0 : open ? heights.full : heights.mini,
    heightStyle,
    measure,
    miniOnly: {
      accessibilityElementsHidden: open,
      importantForAccessibility: open ? ("no-hide-descendants" as const) : ("auto" as const),
      pointerEvents: open ? ("none" as const) : ("box-none" as const),
      style: miniOnlyStyle,
    },
    miniSlots: {
      clock: {
        height: (boxes.clock?.height ?? 0) * clockScale,
        width: (boxes.clock?.width ?? 0) * clockScale,
      },
      play: { height: MINI_PLAY_SIZE, width: MINI_PLAY_SIZE },
      speed: { height: boxes.speed?.height ?? 0, width: boxes.speed?.width ?? 0 },
    },
    onFullLayout: measureHeight("full"),
    onMiniLayout: measureHeight("mini"),
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

const clampProgress = (progress: number) => {
  "worklet";
  return Math.min(Math.max(progress, 0), 1);
};

const sharedMotion = (progress: number, shift: { scale: number; x: number; y: number }) => {
  "worklet";
  const rest = 1 - clampProgress(progress);
  return {
    left: shift.x * rest,
    top: shift.y * rest,
    transform: [{ scale: 1 + (shift.scale - 1) * rest }],
  };
};
