import { useRef, useState } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { cn } from "../lib/cn.ts";
import {
  formatPlaceDistance,
  formatPlaceSize,
  PLACE_RADIUS_MAX,
  PLACE_RADIUS_MIN,
  PLACE_SIZE_STOPS,
  placeRadiusFromSlider,
  sliderFromPlaceRadius,
  snapPlaceRadius,
} from "../lib/places.ts";
import { Text } from "./ui/Text.tsx";

export const PlaceSizeSlider = ({
  onChange,
  radiusMeters,
}: {
  onChange: (radiusMeters: number) => void;
  radiusMeters: number;
}) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const startXRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const thumbSize = 28;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        startXRef.current = event.nativeEvent.locationX;
        const width = trackWidthRef.current;
        if (width > 0) onChangeRef.current(placeRadiusFromSlider(startXRef.current / width));
      },
      onPanResponderMove: (_event, gesture) => {
        const width = trackWidthRef.current;
        if (width > 0) {
          onChangeRef.current(placeRadiusFromSlider((startXRef.current + gesture.dx) / width));
        }
      },
    }),
  ).current;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground font-semibold">Size</Text>
        <Text className="font-semibold text-primary">{formatPlaceSize(radiusMeters)}</Text>
      </View>
      <View
        {...panResponder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Size"
        accessibilityValue={{
          min: PLACE_RADIUS_MIN,
          max: PLACE_RADIUS_MAX,
          now: radiusMeters,
          text: formatPlaceSize(radiusMeters),
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const step = event.nativeEvent.actionName === "increment" ? 25 : -25;
          onChange(snapPlaceRadius(radiusMeters + step));
        }}
        onLayout={(event) => {
          trackWidthRef.current = event.nativeEvent.layout.width;
          setTrackWidth(event.nativeEvent.layout.width);
        }}
        className="h-10 justify-center"
      >
        <View className="h-1.5 rounded-full bg-secondary" pointerEvents="none">
          <View
            className="h-1.5 rounded-full bg-primary"
            style={{ width: sliderFromPlaceRadius(radiusMeters) * trackWidth }}
          />
        </View>
        <View
          pointerEvents="none"
          className="absolute rounded-full border-4 border-card bg-primary shadow-sm shadow-black/20"
          style={{
            width: thumbSize,
            height: thumbSize,
            left: sliderFromPlaceRadius(radiusMeters) * trackWidth - thumbSize / 2,
          }}
        />
      </View>
      <View className="flex-row justify-between">
        <Text className="text-xs text-muted-foreground">
          {formatPlaceDistance(PLACE_RADIUS_MIN)}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {formatPlaceDistance(PLACE_RADIUS_MAX)}
        </Text>
      </View>
      <View className="flex-row gap-2">
        {PLACE_SIZE_STOPS.map((stop) => {
          const selected = stop.radiusMeters === radiusMeters;
          return (
            <Pressable
              key={stop.label}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(stop.radiusMeters)}
              className={cn(
                "flex-1 items-center rounded-xl border px-2 py-2",
                selected ? "border-primary bg-primary/10" : "border-border",
              )}
            >
              <Text className={cn("font-semibold", selected ? "text-primary" : "text-foreground")}>
                {stop.label}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {formatPlaceDistance(stop.radiusMeters)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};
