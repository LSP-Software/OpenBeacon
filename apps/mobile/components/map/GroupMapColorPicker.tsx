import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  GROUP_COLOR_PALETTE,
  type GroupColor,
  getGroupColor,
  setGroupColor,
} from "../../lib/groupColor.ts";
import { Text } from "../ui/Text.tsx";

export const GroupMapColorPicker = ({ groupId }: { groupId: string }) => {
  const [selectedColor, setSelectedColor] = useState<GroupColor>(() => getGroupColor(groupId));

  return (
    <View className="gap-3 rounded-lg border border-border bg-card p-4">
      <View className="gap-1">
        <Text className="text-foreground font-medium">Map marker color</Text>
        <Text className="text-muted-foreground text-sm">
          Used for this group's ring on the live map. Only you see this color.
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {GROUP_COLOR_PALETTE.map((color) => {
          const selected = selectedColor === color;

          return (
            <Pressable
              key={color}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => {
                setGroupColor(groupId, color);
                setSelectedColor(color);
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: color,
                borderWidth: selected ? 3 : 1,
                borderColor: selected ? "#1A1025" : "#FFFFFF",
              }}
            />
          );
        })}
      </View>
    </View>
  );
};
