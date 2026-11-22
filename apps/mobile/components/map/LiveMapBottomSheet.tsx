import { type ReactNode, useEffect, useRef } from "react";
import {
  Animated,
  PanResponder,
  type PanResponderGestureState,
  Platform,
  View,
} from "react-native";
import { useReducedMotion } from "../../hooks/useReducedMotion.ts";
import { useMapBottomInset } from "./MapSurface.tsx";

const ios = Platform.OS === "ios";

const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.9;
const HIDDEN_OFFSET = 520;

export const LiveMapBottomSheet = ({
  accessibilityLabel,
  children,
  header,
  onDismiss,
  onHeightChange,
}: {
  accessibilityLabel: string;
  children?: ReactNode;
  header: ReactNode;
  onDismiss?: (() => void) | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
}) => {
  const reduceMotion = useReducedMotion();
  const bottomInset = useMapBottomInset();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : HIDDEN_OFFSET)).current;
  const dragOriginY = useRef(0);

  useEffect(() => {
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
  }, [translateY]);

  useEffect(() => {
    if (reduceMotion) translateY.setValue(0);
  }, [reduceMotion, translateY]);

  const dismiss = () => {
    if (reduceMotionRef.current) {
      onDismiss?.();
      return;
    }
    Animated.timing(translateY, {
      duration: 180,
      toValue: HIDDEN_OFFSET,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onDismiss?.();
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gestureState) =>
        Math.abs(gestureState.dy) > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
      onPanResponderGrant: () => {
        translateY.stopAnimation((value) => {
          dragOriginY.current = value;
        });
      },
      onPanResponderMove: (_event, gestureState: PanResponderGestureState) => {
        translateY.setValue(Math.max(0, dragOriginY.current + gestureState.dy));
      },
      onPanResponderRelease: (_event, gestureState: PanResponderGestureState) => {
        if (gestureState.dy > DISMISS_DISTANCE || gestureState.vy > DISMISS_VELOCITY) {
          dismiss();
          return;
        }

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
      },
    }),
  ).current;

  return (
    <Animated.View
      accessible={children === undefined}
      accessibilityActions={onDismiss ? [{ name: "dismiss", label: "Dismiss" }] : []}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="summary"
      className="absolute"
      pointerEvents="box-none"
      style={{
        transform: [{ translateY }],
        left: ios ? 12 : 0,
        right: ios ? 12 : 0,
        bottom: ios ? bottomInset + 12 : bottomInset,
      }}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "dismiss") {
          dismiss();
        }
      }}
    >
      <View
        className="bg-card px-5 pb-5 pt-3 shadow-md shadow-black/15"
        style={ios ? { borderRadius: 38 } : { borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
        onLayout={(event) =>
          onHeightChange?.(event.nativeEvent.layout.height + bottomInset + (ios ? 12 : 0))
        }
      >
        {onDismiss ? (
          <View {...panResponder.panHandlers}>
            <View className="mb-3 items-center">
              <View
                className="rounded-full bg-border-strong"
                style={ios ? { height: 5, width: 36, opacity: 0.5 } : { height: 4, width: 32 }}
              />
            </View>
            {header}
          </View>
        ) : (
          <View className="pt-1">{header}</View>
        )}
        {children}
      </View>
    </Animated.View>
  );
};
