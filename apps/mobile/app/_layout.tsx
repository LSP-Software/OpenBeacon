import { View } from "react-native";
import "../global.css";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { AlertHost } from "../components/ui/Alert.tsx";
import { OfflineBanner } from "../components/OfflineBanner.tsx";
import { queryClient } from "../lib/api.ts";
import { DeletionCancellationNotice } from "../providers/DeletionCancellationNotice.tsx";
import { LocationPermissionProvider } from "../providers/LocationPermissionProvider.tsx";
import { ThemeProvider } from "../providers/ThemeProvider.tsx";
import { TrackingProvider } from "../providers/TrackingProvider.tsx";

const RootLayout = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocationPermissionProvider>
          <TrackingProvider>
            <DeletionCancellationNotice />
            <View className="flex-1 bg-background">
              <Stack
                screenOptions={{
                  headerShown: false,
                }}
              />
              <OfflineBanner />
            </View>
          </TrackingProvider>
        </LocationPermissionProvider>
        <AlertHost />
        <PortalHost />
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default RootLayout;
