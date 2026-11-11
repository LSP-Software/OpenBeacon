import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useFullBrightness } from "../hooks/useFullBrightness.ts";
import { createQrCodeShape } from "../lib/qrCodeShape.ts";
import { BeaconIcon } from "./BeaconIcon.tsx";
import { Text } from "./ui/Text.tsx";

export const BrandedQrCode = ({
  accessibilityLabel,
  size,
  value,
}: {
  accessibilityLabel: string;
  size: number;
  value: string;
}) => {
  const shape = useMemo(() => createQrCodeShape(value), [value]);
  useFullBrightness();
  const quietZone = 4;
  const area = shape.size + quietZone * 2;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      className="items-center gap-1 rounded-3xl border border-brand/30 bg-white p-2 pb-4"
    >
      <Svg width={size} height={size} viewBox={`${-quietZone} ${-quietZone} ${area} ${area}`}>
        <Rect x={-quietZone} y={-quietZone} width={area} height={area} fill="#FFFFFF" />
        <Path d={shape.dataPath} fill="#1A1025" />
        <Path d={shape.finderPath} fill="#CC0044" fillRule="evenodd" />
      </Svg>
      <View className="flex-row items-center gap-2">
        <BeaconIcon size={22} color="#FF1464" />
        <Text className="text-[#1A1025] text-lg font-bold">OpenBeacon</Text>
      </View>
    </View>
  );
};
