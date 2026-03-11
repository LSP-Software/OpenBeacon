import { View } from "react-native";
import "../global.css";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </View>
  );
}
