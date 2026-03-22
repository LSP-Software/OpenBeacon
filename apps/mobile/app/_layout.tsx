import { View } from "react-native";
import "../global.css";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Toaster } from "sonner-native";
import { queryClient } from "../lib/api";
import { LocationPermissionProvider } from "../providers/LocationPermissionProvider.tsx";
import { ThemeProvider } from "../providers/ThemeProvider";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView>
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
          <Toaster />
          <PortalHost />
        </ThemeProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
