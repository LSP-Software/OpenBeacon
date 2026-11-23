import { useEffect, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
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
  const dragStart = useSharedValue(1);
  const range = heights.full - heights.mini;
  const dragRange = useSharedValue(range);
  const tapStart = useRef({ x: 0, y: 0 });

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

  useEffect(() => {
    dragRange.value = range;
  }, [dragRange, range]);

  const finishDrag = (velocity: number, dragged: number) => {
    const opened = timelineCardOpens({ progress: dragged, velocity });
    settle(opened, (-velocity * 1000) / Math.max(range, 1));
    setExpanded(opened);
  };
  const cancelDrag = () => settle(open);

  const dragGesture = Gesture.Pan()
    .enabled(collapsible)
    .activeOffsetY([-TAP_SLOP, TAP_SLOP])
    .failOffsetX([-TAP_SLOP, TAP_SLOP])
    .onStart(() => {
      cancelAnimation(progress);
      restingOpen.value = false;
      dragStart.value = progress.value;
    })
    .onUpdate((event) => {
      progress.value = Math.min(
        Math.max(dragStart.value - event.translationY / Math.max(dragRange.value, 1), 0),
        1,
      );
    })
    .onEnd((event, success) => {
      if (success) scheduleOnRN(finishDrag, event.velocityY / 1000, progress.value);
      else scheduleOnRN(cancelDrag);
    });

  const tapToOpen = {
    onStartShouldSetResponder: () => !open,
    onResponderGrant: (event: GestureResponderEvent) => {
      tapStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    },
    onResponderRelease: (event: GestureResponderEvent) => {
      const moved = Math.max(
        Math.abs(event.nativeEvent.pageX - tapStart.current.x),
        Math.abs(event.nativeEvent.pageY - tapStart.current.y),
      );
      if (moved >= TAP_SLOP) return;
      settle(true);
      setExpanded(true);
    },
  };

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
    dragGesture,
    tapToOpen,
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
