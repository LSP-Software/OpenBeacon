import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { createContext, useContext } from "react";
import { Platform, type StyleProp, View, type ViewStyle } from "react-native";
import { useColors } from "../../lib/theme.ts";

export const MapBottomInset = createContext(0);

export const useMapBottomInset = () => useContext(MapBottomInset);

export const MapSurface = ({
  children,
  radius,
  style,
  onLayout,
}: {
  children: React.ReactNode;
  radius: number;
  style?: StyleProp<ViewStyle>;
  onLayout?: React.ComponentProps<typeof View>["onLayout"];
}) => {
  const { isDark, palette } = useColors();

  if (Platform.OS === "ios" && isLiquidGlassAvailable()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={isDark ? "dark" : "light"}
        style={[{ borderRadius: radius, overflow: "hidden" }, style]}
        onLayout={onLayout}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View
      className="shadow-sm shadow-black/15"
      style={[
        {
          borderRadius: radius,
          backgroundColor:
            Platform.OS === "ios"
              ? isDark
                ? "rgba(44, 44, 46, 0.94)"
                : "rgba(255, 255, 255, 0.94)"
              : palette["map-control"],
        },
        style,
      ]}
      onLayout={onLayout}
    >
      {children}
    </View>
  );
};
