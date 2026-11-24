import { useCallback, useEffect, useRef } from "react";
import { Dimensions } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";

const DRAG_SLOP = 8;

export const useSwipeDownToDismiss = (onDismiss: (() => void) | undefined) => {
  const reduceMotion = useReducedMotion();
  const reduceMotionValue = useSharedValue(reduceMotion);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const translateY = useSharedValue(reduceMotion ? 0 : Dimensions.get("window").height);
  const dragOriginY = useSharedValue(0);
  const offscreenY = Dimensions.get("window").height;

  const callDismiss = () => onDismissRef.current?.();

  const settle = useCallback(() => {
    "worklet";
    if (reduceMotionValue.value) {
      translateY.value = 0;
      return;
    }
    translateY.value = withSpring(0, { damping: 34, mass: 1, stiffness: 260 });
  }, [reduceMotionValue, translateY]);

  const dismiss = () => {
    "worklet";
    if (reduceMotionValue.value) {
      scheduleOnRN(callDismiss);
      return;
    }
    translateY.value = withTiming(offscreenY, { duration: 180 }, (finished) => {
      if (finished) scheduleOnRN(callDismiss);
    });
  };

  useEffect(settle, [settle]);

  useEffect(() => {
    reduceMotionValue.value = reduceMotion;
    if (reduceMotion) translateY.value = 0;
  }, [reduceMotion, reduceMotionValue, translateY]);

  const gesture = Gesture.Pan()
    .activeOffsetY(DRAG_SLOP)
    .failOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetY(-DRAG_SLOP)
    .onStart(() => {
      cancelAnimation(translateY);
      dragOriginY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateY.value = Math.max(0, dragOriginY.value + event.translationY);
    })
    .onEnd((event, success) => {
      if (success && (event.translationY > 80 || event.velocityY > 900)) {
        dismiss();
        return;
      }
      settle();
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return { animatedStyle, dismiss, gesture };
};
