import { View } from "react-native";
import { Button } from "../../components/Button.tsx";
import { Text } from "../../components/Text.tsx";

export default function MapScreen() {
  return (
    <View className="flex-1 bg-background">
      <View className="flex-1" />
      <View className="px-4 pb-24">
        <View className="rounded-lg overflow-hidden border border-border bg-surface">
          <View className="p-4 gap-2">
            <View className="gap-1">
              <Text className="text-lg font-semibold">No active group</Text>
              <Text className="text-sm text-muted">
                Create or join a group to see family locations on the map
              </Text>
            </View>
            <Button title="View Groups" variant="secondary" onPress={() => {}} />
          </View>
        </View>
      </View>
    </View>
  );
}
