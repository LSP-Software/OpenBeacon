import { View } from "react-native";
import { Text } from "../../../../components/ui/Text.tsx";

export default function SettingsTab({ groupName }: { groupName: string }) {
  return (
    <View className="pt-1">
      <View className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-5">
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-[1.2px] text-primary">
            Group name
          </Text>
          <Text className="text-foreground text-2xl font-bold">{groupName}</Text>
        </View>
      </View>
    </View>
  );
}
