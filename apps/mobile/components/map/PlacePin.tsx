import { View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Text } from "../ui/Text.tsx";

export const PlacePin = ({
  emoji,
  selected = false,
}: {
  emoji: string | null;
  selected?: boolean;
}) => (
  <View className="size-14 items-center justify-start" pointerEvents="none">
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
