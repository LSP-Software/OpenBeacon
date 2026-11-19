import { type ReactNode, useEffect, useRef } from "react";
import { Animated } from "react-native";
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";
import type { LiveMapPinOffset } from "../../lib/liveMapPinGroups.ts";

const SPRING = { damping: 24, stiffness: 300, mass: 0.9, useNativeDriver: true };

export const LiveMapPinMotion = ({
  arrival,
  children,
  gatherTo,
}: {
  arrival?: LiveMapPinOffset | undefined;
  children: ReactNode;
  gatherTo?: LiveMapPinOffset | undefined;
}) => {
  const reduceMotion = useReducedMotion();
  const translateX = useRef(new Animated.Value(reduceMotion ? 0 : (arrival?.x ?? 0))).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : (arrival?.y ?? 0))).current;
  const scale = useRef(new Animated.Value(arrival?.pop && !reduceMotion ? 0.6 : 1)).current;
  const wasGatheringRef = useRef(false);

  useEffect(() => {
    if (reduceMotion) {
      wasGatheringRef.current = gatherTo !== undefined;
      translateX.setValue(gatherTo?.x ?? 0);
      translateY.setValue(gatherTo?.y ?? 0);
      scale.setValue(1);
      return;
    }
    if (gatherTo) {
      wasGatheringRef.current = true;
      Animated.parallel([
        Animated.spring(translateX, { ...SPRING, toValue: gatherTo.x }),
        Animated.spring(translateY, { ...SPRING, toValue: gatherTo.y }),
      ]).start();
      return;
    }
    if (!arrival && !wasGatheringRef.current) return;
    wasGatheringRef.current = false;
    if (arrival) {
      translateX.setValue(arrival.x);
      translateY.setValue(arrival.y);
    }
    Animated.parallel([
      Animated.spring(translateX, { ...SPRING, toValue: 0 }),
      Animated.spring(translateY, { ...SPRING, toValue: 0 }),
      Animated.spring(scale, { ...SPRING, damping: 16, toValue: 1 }),
    ]).start();
  }, [arrival, gatherTo, reduceMotion, scale, translateX, translateY]);

  return (
    <Animated.View
      collapsable={false}
      pointerEvents={gatherTo ? "none" : "auto"}
      style={{ transform: [{ translateX }, { translateY }, { scale }] }}
    >
      {children}
    </Animated.View>
  );
};
