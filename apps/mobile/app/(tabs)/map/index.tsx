import { View } from "react-native";
import { NativeMap } from "../../../components/map/NativeMap";

export default function MapScreen() {
  return (
    <View className="flex-1 bg-background">
      <NativeMap />
    </View>
  );
}
