import { tryCatch } from "@openbeacon/shared";
import { useEffect, useEffectEvent, useState } from "react";
import { Platform, View } from "react-native";
import {
  OnboardingNote,
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useAppForeground } from "../../hooks/useAppForeground.ts";
import { cn } from "../../lib/cn.ts";
import {
  getLocationPermissionState,
  type LocationPermissionState,
  openLocationSettings,
  requestBackgroundLocationPermissions,
  requestForegroundLocationPermissions,
} from "../../lib/locationPermissions.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { useLocationPermissions } from "../../providers/LocationPermissionProvider.tsx";

const BackgroundLocationStepScreen = () => {
  const noun = thisDeviceNoun();
  const { refreshLocationPermissionState } = useLocationPermissions();
  const advance = useAdvanceOnboardingOnce();
  const [state, setState] = useState<LocationPermissionState | null>(null);
  const [asking, setAsking] = useState(false);

  const check = async () => {
    const result = await tryCatch(getLocationPermissionState());
    if (!result.data) return;
    setState(result.data);
    if (result.data.isReadyForSharing) {
      await refreshLocationPermissionState();
      advance("background");
    }
  };

  const checkEvent = useEffectEvent(check);

  useEffect(() => {
    void checkEvent();
  }, []);

  useAppForeground(() => void check());

  const promptsInApp = state?.canRequestBackgroundInApp ?? false;
  const needsForegroundFirst = state?.missing.includes("foreground") ?? false;
  const asksForLocationFirst = state?.foregroundStatus === "undetermined";

  const allowLocationFirst = async () => {
    setAsking(true);
    const result = await tryCatch(requestForegroundLocationPermissions());
    await refreshLocationPermissionState();
    setAsking(false);
    if (result.data?.foregroundStatus !== "granted") {
      advance("background");
      return;
    }
    setState(result.data);
  };

  const allow = async () => {
    if (asksForLocationFirst) {
      await allowLocationFirst();
      return;
    }
    if (!promptsInApp) {
      await tryCatch(openLocationSettings());
      return;
    }
    setAsking(true);
    const result = await tryCatch(requestBackgroundLocationPermissions());
    await refreshLocationPermissionState();
    setAsking(false);
    if (result.data?.isReadyForSharing || Platform.OS === "ios") {
      advance("background");
      return;
    }
    if (result.data) setState(result.data);
  };

  const choices =
    Platform.OS === "ios"
      ? promptsInApp
        ? {
            heading: `When your ${noun} asks, choose`,
            options: ["Keep Only While Using", "Change to Always Allow"],
            pick: "Change to Always Allow",
            hint: "You can change this any time in Settings → OpenBeacon → Location.",
          }
        : {
            heading: "In Settings → OpenBeacon → Location, choose",
            options: ["Never", "Ask Next Time Or When I Share", "While Using the App", "Always"],
            pick: "Always",
            hint: "Keep “Precise Location” switched on. We’ll open Settings for you. Come back when you’re done and we’ll carry on.",
          }
      : {
          heading: promptsInApp
            ? "On the next screen, choose"
            : "In Settings → Permissions → Location, choose",
          options: [
            "Allow all the time",
            "Allow only while using the app",
            "Ask every time",
            "Don’t allow",
          ],
          pick: "Allow all the time",
          hint: promptsInApp
            ? "Keep “Use precise location” switched on. Come back when you’re done and we’ll carry on."
            : "Keep “Use precise location” switched on. We’ll open Settings for you. Come back when you’re done and we’ll carry on.",
        };

  return (
    <OnboardingScreen
      step="background"
      title="Keep sharing when the app is closed"
      description={
        asksForLocationFirst
          ? "OpenBeacon can’t use your location yet. Allow it first, then you can keep sharing when the app is closed."
          : needsForegroundFirst
            ? "Location is off for OpenBeacon, so there’s nothing to share yet. Turn it on in Settings so your family can see where you are, even when the app is closed."
            : "Without this, your family only sees you while OpenBeacon is open on your screen. The sharing notice stays on either way."
      }
      primary={{
        label: asksForLocationFirst
          ? "Allow location"
          : promptsInApp
            ? "Continue"
            : "Open Settings",
        onPress: allow,
        loading: asking,
        disabled: state === null,
      }}
      secondary={{
        label: "Not now",
        onPress: () => advance("background"),
        disabled: asking,
      }}
    >
      {!asksForLocationFirst && (
        <>
          <View className="gap-2">
            <Text className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              {choices.heading}
            </Text>
            <View className="overflow-hidden rounded-3xl border border-border bg-card">
              {choices.options.map((option, index) => {
                const chosen = option === choices.pick;
                return (
                  <View
                    key={option}
                    accessible={chosen}
                    accessibilityLabel={chosen ? `Choose ${option}` : undefined}
                    importantForAccessibility={chosen ? "yes" : "no-hide-descendants"}
                    accessibilityElementsHidden={!chosen}
                    className={cn(
                      "flex-row items-center gap-3 px-4 py-3.5",
                      index < choices.options.length - 1 && "border-b border-border/50",
                      chosen && "bg-primary/5",
                    )}
                  >
                    <View
                      className={cn(
                        "size-5 items-center justify-center rounded-full border-2",
                        chosen ? "border-primary" : "border-muted-foreground/50",
                      )}
                    >
                      {chosen && <View className="size-2.5 rounded-full bg-primary" />}
                    </View>
                    <Text
                      className={cn(
                        "flex-1 text-base",
                        chosen ? "text-foreground font-semibold" : "text-muted-foreground",
                      )}
                    >
                      {option}
                    </Text>
                    {chosen && (
                      <View className="rounded-full bg-primary px-2.5 py-0.5">
                        <Text className="text-xs font-bold text-white">Pick this</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
          <OnboardingNote text={choices.hint} />
        </>
      )}
    </OnboardingScreen>
  );
};

export default BackgroundLocationStepScreen;
