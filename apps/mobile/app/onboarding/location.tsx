import { tryCatch } from "@openbeacon/shared";
import { CheckIcon } from "lucide-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";
import {
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { requestForegroundLocationPermissions } from "../../lib/locationPermissions.ts";
import { useLocationPermissions } from "../../providers/LocationPermissionProvider.tsx";

const LocationStepScreen = () => {
  const { refreshLocationPermissionState } = useLocationPermissions();
  const advance = useAdvanceOnboardingOnce();
  const [asking, setAsking] = useState(false);

  const allow = async () => {
    setAsking(true);
    const requested = await tryCatch(requestForegroundLocationPermissions());
    const refreshed = await refreshLocationPermissionState();
    setAsking(false);
    const state = refreshed ?? requested.data;
    advance(state?.foregroundStatus === "granted" ? "location" : ["location", "background"]);
  };

  return (
    <OnboardingScreen
      step="location"
      illustration={
        <View
          className="flex-row gap-3 py-2"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <View className="flex-1 items-center gap-2">
            <View className="h-36 w-full items-center justify-center rounded-3xl border-2 border-primary bg-secondary/60">
              <View className="size-11 items-center justify-center rounded-full bg-primary-soft">
                <View className="size-4 rounded-full border-2 border-white bg-primary" />
              </View>
            </View>
            <View className="flex-row items-center gap-1">
              <Icon as={CheckIcon} className="text-primary size-4" />
              <Text className="text-foreground text-sm font-semibold">Precise</Text>
            </View>
          </View>
          <View className="flex-1 items-center gap-2 opacity-70">
            <View className="h-36 w-full items-center justify-center rounded-3xl border border-border bg-secondary/60">
              <View className="size-28 rounded-full border border-dashed border-muted bg-muted/15" />
            </View>
            <Text className="text-tertiary text-sm">Approximate</Text>
          </View>
        </View>
      }
      title="Share where you really are"
      description="OpenBeacon shares nothing until it has precise location and location all the time. Approximate location isn’t enough."
      primary={{ label: "Allow location", onPress: allow, loading: asking }}
      secondary={{
        label: "Not now",
        onPress: () => advance(["location", "background"]),
        disabled: asking,
      }}
    >
      <View className="gap-3 rounded-2xl border border-border bg-card p-4">
        <View className="flex-row gap-3">
          <Text className="text-primary-text text-sm font-bold">1</Text>
          {Platform.OS === "ios" ? (
            <Text className="text-foreground flex-1 text-sm leading-5">
              Leave <Text className="font-semibold text-sm">Precise: On</Text> at the top
            </Text>
          ) : (
            <Text className="text-foreground flex-1 text-sm leading-5">
              Choose <Text className="font-semibold text-sm">Precise</Text>, not Approximate
            </Text>
          )}
        </View>
        <View className="flex-row gap-3">
          <Text className="text-primary-text text-sm font-bold">2</Text>
          <Text className="text-foreground flex-1 text-sm leading-5">
            Choose{" "}
            <Text className="font-semibold text-sm">
              {Platform.OS === "ios" ? "Allow While Using App" : "While using the app"}
            </Text>
            . We’ll ask about the background next.
          </Text>
        </View>
      </View>
    </OnboardingScreen>
  );
};

export default LocationStepScreen;
