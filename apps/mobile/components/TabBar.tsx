import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "../lib/theme.ts";

type TabRoute = { key: string; name: string };

const { width: SCREEN_W } = Dimensions.get("window");
const LIFT = 20;
const CENTER_SIZE = 66;
const BAR_HEIGHT = 62;
const BAR_MARGIN = 16;
const OUTER_HEIGHT = BAR_HEIGHT + LIFT;
const CENTER_HIT = CENTER_SIZE + 24;
const CENTER_HIT_LEFT = SCREEN_W / 2 - CENTER_HIT / 2;

function GroupsIcon({ color, size }: { color: string; size: number }) {
  const dot = Math.round(size * 0.44);
  const overlap = Math.round(dot * 0.28);
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View style={{ flexDirection: "row" }}>
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: color,
            opacity: 0.5,
          }}
        />
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: color,
            marginLeft: -overlap,
          }}
        />
      </View>
    </View>
  );
}

function LocationPinIcon({ color, size }: { color: string; size: number }) {
  const circleW = Math.round(size * 0.6);
  const dotS = Math.round(circleW * 0.3);
  const tipHalfW = Math.round(circleW * 0.28);
  const tipH = Math.round(circleW * 0.35);
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: circleW,
            height: circleW,
            borderRadius: circleW / 2,
            borderWidth: 2.5,
            borderColor: color,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{ width: dotS, height: dotS, borderRadius: dotS / 2, backgroundColor: color }}
          />
        </View>
        <View
          style={{
            width: 0,
            height: 0,
            marginTop: -1.5,
            borderLeftWidth: tipHalfW,
            borderRightWidth: tipHalfW,
            borderTopWidth: tipH,
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
            borderTopColor: color,
          }}
        />
      </View>
    </View>
  );
}

function PersonIcon({ color, size }: { color: string; size: number }) {
  const headD = Math.round(size * 0.38);
  const bodyW = Math.round(size * 0.6);
  const bodyH = Math.round(size * 0.26);
  return (
    <View
      style={{ width: size, height: size, justifyContent: "center", alignItems: "center", gap: 3 }}
    >
      <View
        style={{ width: headD, height: headD, borderRadius: headD / 2, backgroundColor: color }}
      />
      <View
        style={{
          width: bodyW,
          height: bodyH,
          borderRadius: bodyH,
          backgroundColor: color,
          opacity: 0.7,
        }}
      />
    </View>
  );
}

function SideTab({
  route,
  isActive,
  onPress,
  colors,
}: {
  route: TabRoute;
  isActive: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const label = route.name === "groups" ? "Groups" : "Account";

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.78,
        duration: 75,
        useNativeDriver: true,
        easing: Easing.in(Easing.quad),
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 320,
        friction: 10,
      }),
    ]).start();
    onPress();
  };

  const color = isActive ? colors.primary : colors.textMuted;

  return (
    <Pressable
      onPress={handlePress}
      style={styles.sideTab}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
    >
      <Animated.View style={{ alignItems: "center", gap: 4, transform: [{ scale }] }}>
        {route.name === "groups" ? (
          <GroupsIcon color={color} size={22} />
        ) : (
          <PersonIcon color={color} size={22} />
        )}
        <Text
          style={[
            styles.tabLabel,
            { color, fontWeight: isActive ? "700" : "400" },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function CenterMapButton({
  isActive,
  onPress,
  colors,
}: {
  isActive: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const glow = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [glow]);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(pressScale, {
        toValue: 0.86,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(pressScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 280,
        friction: 9,
      }),
    ]).start();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.centerHitArea, { left: CENTER_HIT_LEFT }]}
      accessibilityRole="tab"
      accessibilityLabel="Maps"
      accessibilityState={{ selected: isActive }}
    >
      <Animated.View
        style={[
          styles.glowRing,
          {
            backgroundColor: colors.primary,
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.centerBtn,
          {
            backgroundColor: colors.primary,
            transform: [{ scale: pressScale }],
            shadowColor: colors.primary,
          },
        ]}
      >
        <LocationPinIcon color="#FFFFFF" size={30} />
      </Animated.View>
      <Text
        style={[
          styles.centerLabel,
          { color: isActive ? colors.primary : colors.textMuted },
        ]}
      >
        Maps
      </Text>
    </Pressable>
  );
}

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const colors = useColors();

  const handleTabPress = (route: TabRoute, isActive: boolean) => {
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!isActive && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  const mapsRoute = state.routes.find((r) => r.name === "map");
  const mapsIndex = state.routes.findIndex((r) => r.name === "map");

  return (
    <View
      style={{
        height: OUTER_HEIGHT + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: colors.background,
      }}
    >
      <View
        style={[
          styles.bar,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {state.routes.map((route, index) => {
          const isActive = state.index === index;
          if (route.name === "map") {
            return <View key={route.key} style={styles.centerSlot} />;
          }
          return (
            <SideTab
              key={route.key}
              route={route}
              isActive={isActive}
              onPress={() => handleTabPress(route, isActive)}
              colors={colors}
            />
          );
        })}
      </View>

      {mapsRoute !== undefined && (
        <CenterMapButton
          isActive={state.index === mapsIndex}
          onPress={() => handleTabPress(mapsRoute, state.index === mapsIndex)}
          colors={colors}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0,
    left: BAR_MARGIN,
    right: BAR_MARGIN,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  sideTab: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  centerSlot: {
    width: CENTER_SIZE + 20,
  },
  centerHitArea: {
    position: "absolute",
    top: 0,
    width: CENTER_HIT,
    height: OUTER_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  glowRing: {
    position: "absolute",
    top: 0,
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
  },
  centerBtn: {
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
  },
  centerLabel: {
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 5,
    fontWeight: "600",
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
});
