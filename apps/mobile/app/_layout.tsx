import { View } from "react-native";
import "../global.css";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { queryClient } from "../lib/api.ts";
import { LocationPermissionProvider } from "../providers/LocationPermissionProvider.tsx";
import { ThemeProvider } from "../providers/ThemeProvider.tsx";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocationPermissionProvider>
          <View className="flex-1 bg-background">
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            />
          </View>
        </LocationPermissionProvider>
        <PortalHost />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
