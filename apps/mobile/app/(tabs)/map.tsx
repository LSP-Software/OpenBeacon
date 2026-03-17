import { View } from "react-native";
import { NativeMap } from "../../components/map/NativeMap.tsx";

export default function MapScreen() {
  return (
    <View className="flex-1 bg-background">
      <NativeMap />
    </View>
  );
}
