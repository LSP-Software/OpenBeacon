import { View } from "react-native";
import "../global.css";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import {
  ApiCompatibilityGate,
  useApiCompatibilityGateShown,
} from "../components/ApiCompatibilityGate.tsx";
import { AlertHost } from "../components/ui/Alert.tsx";
import { OfflineBanner } from "../components/OfflineBanner.tsx";
import { queryClient } from "../lib/api.ts";
import { DeletionCancellationNotice } from "../providers/DeletionCancellationNotice.tsx";
import { LocationPermissionProvider } from "../providers/LocationPermissionProvider.tsx";
import { SessionDataCleanup } from "../providers/SessionDataCleanup.tsx";
import { ThemeProvider } from "../providers/ThemeProvider.tsx";
import { TrackingProvider } from "../providers/TrackingProvider.tsx";

const RootLayout = () => {
  const compatibilityGateShown = useApiCompatibilityGateShown();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocationPermissionProvider>
          <TrackingProvider>
            <SessionDataCleanup />
            <DeletionCancellationNotice />
            <View className="flex-1 bg-background">
              <View
                className="flex-1"
                importantForAccessibility={compatibilityGateShown ? "no-hide-descendants" : "auto"}
                accessibilityElementsHidden={compatibilityGateShown}
              >
                <Stack
                  screenOptions={{
                    headerShown: false,
                  }}
                />
              </View>
              <ApiCompatibilityGate />
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
