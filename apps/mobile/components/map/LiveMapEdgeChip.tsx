import { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";
import { LiveMapStackPin } from "./LiveMapStackPin.tsx";

const CHIP_SCALE = 0.84;
const SPRING = { damping: 18, stiffness: 280, mass: 0.9, useNativeDriver: true };

export const LiveMapEdgeChip = ({
  angle,
  members,
  onPress,
  x,
  y,
}: {
  angle: number;
  members: readonly LiveMapMarker[];
  onPress: () => void;
  x: number;
  y: number;
}) => {
  const [lead] = members;
  const scale = useRef(new Animated.Value(CHIP_SCALE * 0.5)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const previousRef = useRef({ count: members.length, x, y });

  useEffect(() => {
    Animated.spring(scale, { ...SPRING, toValue: CHIP_SCALE }).start();
  }, [scale]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { count: members.length, x, y };
    if (previous.count === members.length) return;
    translateX.setValue(previous.x - x);
    translateY.setValue(previous.y - y);
    scale.setValue(CHIP_SCALE * 1.14);
    Animated.parallel([
      Animated.spring(translateX, { ...SPRING, toValue: 0 }),
      Animated.spring(translateY, { ...SPRING, toValue: 0 }),
      Animated.spring(scale, { ...SPRING, toValue: CHIP_SCALE }),
    ]).start();
  }, [members.length, scale, translateX, translateY, x, y]);

  if (!lead) return null;
  const peopleCount = members.length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        peopleCount === 1 ? `Go to ${lead.name}` : `Show ${peopleCount} people off screen`
      }
      onPress={onPress}
      style={{ position: "absolute", left: x - 24, top: y - 24 }}
    >
      <Animated.View style={{ transform: [{ translateX }, { translateY }, { scale }] }}>
        {peopleCount === 1 ? (
          <LiveMapMarkerPin
            hasUnreadableUpdate={lead.unreadableGroup !== undefined}
            image={lead.image}
            initials={lead.initials}
            name={lead.name}
            ringColor={lead.ringColor}
            ringColors={lead.ringColors}
            timestamp={lead.timestamp}
          />
        ) : (
          <LiveMapStackPin members={members} />
        )}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 48,
            height: 48,
            alignItems: "center",
            transform: [{ rotate: `${angle}deg` }],
          }}
        >
          <View
            style={{
              marginTop: -9,
              width: 0,
              height: 0,
              borderLeftWidth: 7,
              borderRightWidth: 7,
              borderBottomWidth: 10,
              borderLeftColor: "transparent",
              borderRightColor: "transparent",
              borderBottomColor: lead.ringColor,
            }}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
};
