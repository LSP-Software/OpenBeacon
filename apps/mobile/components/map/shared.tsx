import { View } from "react-native";
import { Text } from "../Text.tsx";

export function UnsupportedMap() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-center text-base text-muted">
        Maps are only available in the native app.
      </Text>
    </View>
  );
}

export function MissingMapConfig() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-center text-base text-muted">
        The Protomoaps public API key is missing. Set EXPO_PUBLIC_PROTOMAPS_API_KEY to load the map.
      </Text>
    </View>
  );
}
