import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useMapBottomInset } from "./MapSurface.tsx";
import { useSwipeDownToDismiss } from "./useSwipeDownToDismiss.ts";

const ios = Platform.OS === "ios";

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
  const bottomInset = useMapBottomInset();
  const { animatedStyle, dismiss, gesture } = useSwipeDownToDismiss(onDismiss);

  return (
    <Animated.View
      accessible={children === undefined}
      accessibilityActions={onDismiss ? [{ name: "dismiss", label: "Dismiss" }] : []}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="summary"
      className="absolute"
      pointerEvents="box-none"
      style={[
        {
          left: ios ? 12 : 0,
          right: ios ? 12 : 0,
          bottom: ios ? bottomInset + 12 : bottomInset,
        },
        animatedStyle,
      ]}
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
          <GestureDetector gesture={gesture}>
            <View>
              <View className="mb-3 items-center">
                <View
                  className="rounded-full bg-border-strong"
                  style={ios ? { height: 5, width: 36, opacity: 0.5 } : { height: 4, width: 32 }}
                />
              </View>
              {header}
            </View>
          </GestureDetector>
        ) : (
          <View className="pt-1">{header}</View>
        )}
        {children}
      </View>
    </Animated.View>
  );
};
