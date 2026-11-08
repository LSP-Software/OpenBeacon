import { type ReactNode, useEffect, useRef } from "react";
import { Animated, PanResponder, type PanResponderGestureState, View } from "react-native";

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
  onDismiss: () => void;
  onHeightChange?: ((height: number) => void) | undefined;
}) => {
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const dragOriginY = useRef(0);

  useEffect(() => {
    Animated.spring(translateY, {
      damping: 22,
      stiffness: 220,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }, [translateY]);

  const dismiss = () => {
    Animated.timing(translateY, {
      duration: 180,
      toValue: HIDDEN_OFFSET,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onDismiss();
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
      accessibilityActions={[{ name: "dismiss", label: "Dismiss" }]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="summary"
      className="absolute bottom-3 left-3 right-3"
      pointerEvents="box-none"
      style={{ transform: [{ translateY }] }}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "dismiss") {
          dismiss();
        }
      }}
    >
      <View
        className="rounded-2xl border border-border bg-card px-5 pb-4 pt-3 shadow-md shadow-black/15"
        onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      >
        <View {...panResponder.panHandlers}>
          <View className="mb-3 items-center">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          {header}
        </View>
        {children}
      </View>
    </Animated.View>
  );
};
