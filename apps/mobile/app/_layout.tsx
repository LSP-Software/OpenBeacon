import { View } from "react-native";
import "../global.css";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { queryClient } from "../lib/api";
import { ThemeProvider } from "../providers/ThemeProvider";

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
      <PortalHost />
    </QueryClientProvider>
  );
}
