import { useQuery } from "@tanstack/react-query";
import { FingerprintIcon, ScanFaceIcon } from "lucide-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";
import {
  OnboardingNote,
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { useAppForeground } from "../../hooks/useAppForeground.ts";
import { Alert } from "../../lib/alert.ts";
import { phoneScreenLockQueryOptions, turnOnAppLock } from "../../lib/appLock.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";

const AppLockStepScreen = () => {
  const noun = thisDeviceNoun();
  const advance = useAdvanceOnboardingOnce();
  const [turningOn, setTurningOn] = useState(false);
  const screenLock = useQuery(phoneScreenLockQueryOptions);
  const unavailable = screenLock.data === false;

  useAppForeground(() => void screenLock.refetch());

  const turnOn = async () => {
    setTurningOn(true);
    const result = await turnOnAppLock();
    setTurningOn(false);
    if (result === "confirmed") {
      advance("appLock");
      return;
    }
    if (result === "noScreenLock") void screenLock.refetch();
    if (result === "lockedOut") Alert.alert("Too many tries", "Wait a moment, then try again.");
  };

  return (
    <OnboardingScreen
      step="appLock"
      illustration={
        <View className="items-center py-6">
          <View className="size-24 items-center justify-center rounded-3xl bg-card">
            <Icon
              as={Platform.OS === "ios" ? ScanFaceIcon : FingerprintIcon}
              className="text-primary size-12"
            />
          </View>
        </View>
      }
      title="Lock OpenBeacon"
      description={
        Platform.OS === "ios"
          ? `Optional. Ask for Face ID, Touch ID or your passcode before anyone can open OpenBeacon on this ${noun}.`
          : `Optional. Ask for your face, fingerprint or screen lock before anyone can open OpenBeacon on this ${noun}.`
      }
      primary={
        unavailable
          ? { label: "Continue", onPress: () => advance("appLock") }
          : {
              label: "Turn on app lock",
              onPress: turnOn,
              loading: turningOn,
              disabled: screenLock.isPending,
            }
      }
      secondary={
        unavailable
          ? undefined
          : { label: "No thanks", onPress: () => advance("appLock"), disabled: turningOn }
      }
    >
      <OnboardingNote
        text={
          unavailable
            ? `This ${noun} has no screen lock. Set one in your ${noun}’s settings, then turn on app lock in Account → App lock.`
            : Platform.OS === "ios"
              ? "Sharing keeps running while the app is locked, and the location indicator stays on. Change this any time in Account → App lock."
              : "Sharing keeps running while the app is locked, and the sharing notification stays on. Change this any time in Account → App lock."
        }
      />
    </OnboardingScreen>
  );
};

export default AppLockStepScreen;
