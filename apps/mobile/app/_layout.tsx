import { View } from "react-native";
import "../global.css";
import { Stack } from "expo-router";
import { ThemeProvider } from "../providers/ThemeProvider";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/api";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <View className="flex-1 bg-background">
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          />
        </View>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
