import { View } from "react-native";
import { NativeMap } from "../../../components/map/NativeMap.tsx";
import { useMapLivePositions } from "../../../hooks/useMapLivePositions.ts";

export default function MapScreen() {
  useMapLivePositions();

  return (
    <View className="flex-1 bg-background">
      <NativeMap />
    </View>
  );
}
