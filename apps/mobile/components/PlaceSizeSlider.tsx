import { Slider as ComposeSlider } from "@expo/ui/jetpack-compose";
import { Slider as SwiftSlider } from "@expo/ui/swift-ui";
import { accessibilityLabel, accessibilityValue, tint } from "@expo/ui/swift-ui/modifiers";
import { Platform, View } from "react-native";
import {
  formatPlaceDistance,
  formatPlaceSize,
  PLACE_RADIUS_MAX,
  PLACE_RADIUS_MIN,
  PLACE_SIZE_STOPS,
  placeRadiusFromSlider,
  sliderFromPlaceRadius,
} from "../lib/places.ts";
import { useColors } from "../lib/theme.ts";
import { AndroidHost, IosHost } from "./ui/NativeHost.tsx";
import { SegmentedControl } from "./ui/SegmentedControl.tsx";
import { Text } from "./ui/Text.tsx";

export const PlaceSizeSlider = ({
  onChange,
  radiusMeters,
}: {
  onChange: (radiusMeters: number) => void;
  radiusMeters: number;
}) => {
  const { palette } = useColors();
  const position = sliderFromPlaceRadius(radiusMeters);
  const change = (value: number) => onChange(placeRadiusFromSlider(value));

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground font-semibold">Size</Text>
        <Text className="font-semibold text-primary-text">{formatPlaceSize(radiusMeters)}</Text>
      </View>
      {Platform.OS === "ios" ? (
        <IosHost matchContents={{ vertical: true }} style={{ width: "100%" }}>
          <SwiftSlider
            value={position}
            min={0}
            max={1}
            onValueChange={change}
            modifiers={[
              tint(palette.action),
              accessibilityLabel("Size"),
              accessibilityValue(formatPlaceSize(radiusMeters)),
            ]}
          />
        </IosHost>
      ) : (
        <AndroidHost matchContents={{ vertical: true }} style={{ width: "100%" }}>
          <ComposeSlider
            value={position}
            min={0}
            max={1}
            onValueChange={change}
            colors={{
              thumbColor: palette["primary-text"],
              activeTrackColor: palette["primary-text"],
              inactiveTrackColor: palette.secondary,
            }}
          />
        </AndroidHost>
      )}
      <View className="flex-row justify-between">
        <Text className="text-xs text-tertiary">{formatPlaceDistance(PLACE_RADIUS_MIN)}</Text>
        <Text className="text-xs text-tertiary">{formatPlaceDistance(PLACE_RADIUS_MAX)}</Text>
      </View>
      <SegmentedControl
        accessibilityLabel="Place size"
        options={PLACE_SIZE_STOPS.map((stop) => ({ value: stop.radiusMeters, label: stop.label }))}
        selected={radiusMeters}
        onChange={onChange}
      />
    </View>
  );
};
