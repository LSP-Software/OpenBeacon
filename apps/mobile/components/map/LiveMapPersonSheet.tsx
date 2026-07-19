import { useEffect, useRef } from "react";
import { Animated, PanResponder, type PanResponderGestureState, View } from "react-native";
import { useTimeSince } from "../../hooks/useTimeSince.ts";
import { getBatteryVisual } from "../../lib/batteryVisual.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.9;
const HIDDEN_OFFSET = 360;

export const LiveMapPersonSheet = ({
  battery,
  image,
  initials,
  name,
  onDismiss,
  otherSharedGroupNames,
  timestamp,
}: {
  battery: { charging: boolean; level: number } | null;
  image: string | null;
  initials: string;
  name: string;
  onDismiss: () => void;
  otherSharedGroupNames: readonly string[];
  timestamp: string;
}) => {
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const dragOriginY = useRef(0);
  const updatedAge = useTimeSince(timestamp);
  const batteryVisual = battery
    ? getBatteryVisual({
        batteryLevel: battery.level,
        charging: battery.charging,
      })
    : null;

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
      accessible
      accessibilityActions={[{ name: "dismiss", label: "Dismiss" }]}
      accessibilityLabel={`${name} details`}
      accessibilityRole="summary"
      className="absolute bottom-3 left-3 right-3"
      pointerEvents="box-none"
      style={{ transform: [{ translateY }] }}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "dismiss") {
          dismiss();
        }
      }}
      {...panResponder.panHandlers}
    >
      <View className="rounded-2xl border border-border bg-card px-5 pb-4 pt-3 shadow-md shadow-black/15">
        <View className="mb-3 items-center">
          <View className="h-1 w-10 rounded-full bg-border" />
        </View>
        <View className="flex-row items-center gap-3">
          <Avatar alt={name} className="size-12">
            {image ? <AvatarImage source={{ uri: image }} /> : null}
            <AvatarFallback>
              <Text className="font-bold">{initials}</Text>
            </AvatarFallback>
          </Avatar>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-foreground text-xl font-bold">{name}</Text>
            <Text className="text-muted text-sm">Updated {updatedAge}</Text>
          </View>
        </View>
        {battery && batteryVisual ? (
          <View className="mt-3 flex-row items-center gap-2">
            <Icon as={batteryVisual.icon} size={20} className={batteryVisual.colorClass} />
            <Text className={`${batteryVisual.colorClass} text-sm`}>Battery: {battery.level}%</Text>
          </View>
        ) : null}
        {otherSharedGroupNames.length > 0 ? (
          <Text className="text-muted-foreground mt-2 text-sm">
            Also in {otherSharedGroupNames.join(", ")}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
};
