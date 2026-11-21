import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { cn } from "../../lib/cn.ts";
import { Text } from "../ui/Text.tsx";

const shadowPath = (radius: number) => {
  const tipY = 24 + 22 * Math.SQRT2;
  const tangentCos = radius / (tipY - 24);
  const tangentX = radius * Math.sqrt(1 - tangentCos ** 2);
  const tangentY = 24 + radius * tangentCos;
  return `M ${28 - tangentX} ${tangentY} A ${radius} ${radius} 0 1 1 ${28 + tangentX} ${tangentY} L 28 ${tipY} Z`;
};

export const PlacePin = ({
  drawnAsBitmap = false,
  emoji,
  selected = false,
}: {
  drawnAsBitmap?: boolean;
  emoji: string | null;
  selected?: boolean;
}) => (
  <View className="size-14 items-center justify-start" pointerEvents="none">
    {drawnAsBitmap ? (
      <Svg width={56} height={56} style={{ position: "absolute", left: 0, top: 0 }}>
        {[24, 23, 22].map((radius) => (
          <Path key={radius} d={shadowPath(radius)} fill="#000000" fillOpacity={0.08} />
        ))}
      </Svg>
    ) : null}
    <View
      className={cn(
        "size-11 items-center justify-center border-[3px] border-primary shadow-md shadow-black/25",
        selected ? "bg-primary" : "bg-card",
      )}
      style={{
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        borderBottomLeftRadius: 22,
        borderBottomRightRadius: 0,
        transform: [{ rotate: "45deg" }],
      }}
    >
      <View style={{ transform: [{ rotate: "-45deg" }] }}>
        {emoji ? (
          <Text className="text-xl">{emoji}</Text>
        ) : (
          <View className={cn("size-3.5 rounded-full", selected ? "bg-card" : "bg-primary")} />
        )}
      </View>
    </View>
  </View>
);
