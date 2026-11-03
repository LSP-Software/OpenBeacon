import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOfflineStatus } from "../lib/networkStatus.ts";

export const OfflineBanner = () => {
  const offline = useOfflineStatus();
  const insets = useSafeAreaInsets();

  if (!offline) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: insets.top,
        backgroundColor: "#b91c1c",
        alignItems: "center",
        paddingBottom: 8,
      }}
    >
      <Text style={{ color: "white", fontWeight: "600" }}>No internet connection</Text>
    </View>
  );
};
