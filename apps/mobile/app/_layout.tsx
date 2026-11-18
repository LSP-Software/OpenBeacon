import { View } from "react-native";
import "../global.css";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import {
  ApiCompatibilityGate,
  useApiCompatibilityGateShown,
} from "../components/ApiCompatibilityGate.tsx";
import { AppLockScreen } from "../components/AppLockScreen.tsx";
import { InAppNoticeBanner } from "../components/InAppNoticeBanner.tsx";
import { AlertHost } from "../components/ui/Alert.tsx";
import { OfflineBanner } from "../components/OfflineBanner.tsx";
import { queryClient } from "../lib/api.ts";
import { useAppLock } from "../lib/appLock.ts";
import { authClient } from "../lib/auth-client.ts";
import { useThisDeviceState } from "../lib/deviceActivation.ts";
import { useDismissNoticesWhenOpened } from "../lib/notifications.ts";
import { DeletionCancellationNotice } from "../providers/DeletionCancellationNotice.tsx";
import { LocationPermissionProvider } from "../providers/LocationPermissionProvider.tsx";
import { SessionDataCleanup } from "../providers/SessionDataCleanup.tsx";
import { ThemeProvider } from "../providers/ThemeProvider.tsx";
import { TrackingProvider } from "../providers/TrackingProvider.tsx";

const RootLayout = () => {
  const compatibilityGateShown = useApiCompatibilityGateShown();
  const { data: session, isPending } = authClient.useSession();
  const thisDevice = useThisDeviceState();
  const { locked, away } = useAppLock();
  const covered = locked || away;
  useDismissNoticesWhenOpened();

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
                importantForAccessibility={
                  compatibilityGateShown || covered ? "no-hide-descendants" : "auto"
                }
                accessibilityElementsHidden={compatibilityGateShown || covered}
              >
                <Stack
                  screenOptions={{
                    headerShown: false,
                  }}
                >
                  <Stack.Screen name="index" />
                  <Stack.Protected
                    guard={
                      thisDevice === "active" ||
                      (!session && (!isPending || thisDevice === "unregistered"))
                    }
                  >
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="join" />
                    <Stack.Screen name="place" />
                    <Stack.Screen name="place-alerts" />
                    <Stack.Screen name="timeline" />
                    <Stack.Screen name="setup/name" />
                    <Stack.Screen name="onboarding/sharing" />
                    <Stack.Screen name="onboarding/notifications" />
                    <Stack.Screen name="onboarding/location" />
                    <Stack.Screen name="onboarding/background" />
                    <Stack.Screen name="onboarding/recovery" />
                    <Stack.Screen name="onboarding/app-lock" />
                    <Stack.Screen name="onboarding/done" />
                    <Stack.Screen name="setup/remove-devices" />
                    <Stack.Screen name="account/about" />
                    <Stack.Screen name="account/add-device" />
                    <Stack.Screen name="account/app-lock" />
                    <Stack.Screen name="account/contact-us" />
                    <Stack.Screen name="account/delete" />
                    <Stack.Screen name="account/devices" />
                    <Stack.Screen name="account/notifications" />
                    <Stack.Screen name="account/map-storage" />
                    <Stack.Screen name="account/password" />
                    <Stack.Screen name="account/recovery" />
                    <Stack.Screen name="account/recovery-change" />
                    <Stack.Screen name="account/recovery-setup" />
                    <Stack.Screen name="account/remove-device" />
                    <Stack.Screen name="account/sign-out-others" />
                    <Stack.Screen name="account/sign-in-codes" />
                    <Stack.Screen name="account/theme" />
                    <Stack.Screen name="account/location-history" />
                    <Stack.Screen name="account/who-can-see-me" />
                  </Stack.Protected>
                </Stack>
              </View>
              <View
                className="absolute inset-0"
                pointerEvents="box-none"
                importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
                accessibilityElementsHidden={covered}
              >
                <ApiCompatibilityGate />
                <OfflineBanner />
                {session ? <InAppNoticeBanner /> : null}
              </View>
            </View>
          </TrackingProvider>
        </LocationPermissionProvider>
        <View
          className="absolute inset-0"
          pointerEvents="box-none"
          importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
          accessibilityElementsHidden={covered}
        >
          <AlertHost />
          <PortalHost />
        </View>
        <AppLockScreen />
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default RootLayout;
