import { useEffect, useRef } from "react";
import { Animated, Dimensions, PanResponder, type PanResponderGestureState } from "react-native";
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";

export const useSwipeDownToDismiss = (onDismiss: (() => void) | undefined) => {
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const translateY = useRef(
    new Animated.Value(reduceMotion ? 0 : Dimensions.get("window").height),
  ).current;
  const dragOriginY = useRef(0);

  const settle = () => {
    if (reduceMotionRef.current) {
      translateY.setValue(0);
      return;
    }
    Animated.spring(translateY, {
      damping: 22,
      stiffness: 220,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  useEffect(settle, [translateY]);

  useEffect(() => {
    if (reduceMotion) translateY.setValue(0);
  }, [reduceMotion, translateY]);

  const dismiss = () => {
    if (reduceMotionRef.current) {
      onDismissRef.current?.();
      return;
    }
    Animated.timing(translateY, {
      duration: 180,
      toValue: Dimensions.get("window").height,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDismissRef.current?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gestureState) =>
        gestureState.dy > 8 && gestureState.dy > Math.abs(gestureState.dx) * 1.5,
      onPanResponderGrant: () => {
        translateY.stopAnimation((value) => {
          dragOriginY.current = value;
        });
      },
      onPanResponderMove: (_event, gestureState: PanResponderGestureState) => {
        translateY.setValue(Math.max(0, dragOriginY.current + gestureState.dy));
      },
      onPanResponderRelease: (_event, gestureState: PanResponderGestureState) => {
        if (gestureState.dy > 80 || gestureState.vy > 0.9) {
          dismiss();
          return;
        }
        settle();
      },
      onPanResponderTerminate: settle,
    }),
  ).current;

  return { dismiss, panHandlers: panResponder.panHandlers, translateY };
};
