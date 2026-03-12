import { View } from "react-native";
import "../global.css";
import { Stack } from "expo-router";
import { ThemeProvider } from "../providers/ThemeProvider";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <View className="flex-1 bg-background">
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        />
      </View>
    </ThemeProvider>
  );
}
