import { Clock3Icon } from "lucide-react-native";
import { View } from "react-native";
import { Icon } from "../../../../components/ui/Icon.tsx";
import { Text } from "../../../../components/ui/Text.tsx";

export default function HistoryTab() {
  return (
    <View className="pt-1">
      <View className="overflow-hidden rounded-2xl border border-border bg-card px-5 py-5">
        <View className="gap-4">
          <View className="size-12 items-center justify-center rounded-full border border-primary/15 bg-primary/10">
            <Icon as={Clock3Icon} size={20} className="text-primary" />
          </View>
          <View className="gap-2">
            <Text className="text-foreground text-2xl font-bold">Timeline coming next</Text>
            <Text className="text-sm leading-6 text-muted-foreground">
              This space will eventually show arrivals, departures, and the movement timeline that
              matters to your family.
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
