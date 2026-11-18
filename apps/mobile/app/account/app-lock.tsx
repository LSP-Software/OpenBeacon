import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { ScreenHeader } from "../../components/headers/ScreenHeader.tsx";
import { ChoiceList } from "../../components/ui/ChoiceList.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { Alert } from "../../lib/alert.ts";
import {
  changeRelockAfter,
  hasScreenLock,
  turnOffAppLock,
  turnOnAppLock,
  useAppLock,
} from "../../lib/appLock.ts";
import type { RelockAfter } from "../../lib/appLockTypes.ts";

const relockOptions = [
  { value: 0, title: "Immediately", description: "As soon as you leave OpenBeacon." },
  { value: 60_000, title: "After 1 minute", description: "If you’re away for a minute or more." },
  {
    value: 300_000,
    title: "After 5 minutes",
    description: "If you’re away for five minutes or more.",
  },
] as const satisfies readonly { value: RelockAfter; title: string; description: string }[];

const AppLockSettingsScreen = () => {
  const { enabled, relockAfter } = useAppLock();
  const [requested, setRequested] = useState<boolean | null>(null);
  const screenLock = useQuery({
    queryKey: ["phoneScreenLock"],
    queryFn: hasScreenLock,
    staleTime: 0,
  });
  const unavailable = !enabled && screenLock.data === false;

  const changeRelock = async (next: RelockAfter) => {
    const result = await changeRelockAfter(next);
    if (result === "lockedOut") {
      Alert.alert("Too many tries", "Wait a moment, then try again.");
    }
  };

  const toggle = async (next: boolean) => {
    setRequested(next);
    const result = next ? await turnOnAppLock() : await turnOffAppLock();
    setRequested(null);
    if (result === "noScreenLock") {
      void screenLock.refetch();
      if (next) {
        Alert.alert(
          "Set a screen lock first",
          "App lock uses your phone’s screen lock. Set one in your phone’s settings, then try again.",
        );
      }
    }
    if (result === "lockedOut") {
      Alert.alert("Too many tries", "Wait a moment, then try again.");
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="App lock" />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-8 px-6 py-6 pb-32"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text className="text-foreground text-3xl font-bold">Lock OpenBeacon</Text>
          <Text className="text-tertiary text-base leading-6">
            {Platform.OS === "ios"
              ? "Ask for Face ID, Touch ID or your passcode before anyone can open OpenBeacon on this phone. Location sharing keeps running while the app is locked, and the location indicator stays on. OpenBeacon’s preview in the app switcher is hidden while app lock is on."
              : "Ask for your face, fingerprint or screen lock before anyone can open OpenBeacon on this phone. Location sharing keeps running while the app is locked, and the sharing notification stays on. On Android 13 and later, OpenBeacon’s preview in recent apps is hidden while app lock is on."}
          </Text>
        </View>

        <View className="flex-row items-center gap-4 rounded-3xl border border-border bg-card px-5 py-4">
          <View className="flex-1 gap-1">
            <Text className="text-foreground text-base font-medium">App lock</Text>
            <Text className="text-tertiary text-sm">
              {unavailable
                ? "This phone has no screen lock. Set one in your phone’s settings to use app lock."
                : enabled
                  ? "On for this phone."
                  : "Off for this phone."}
            </Text>
          </View>
          <Switch
            accessibilityLabel="App lock"
            value={requested ?? enabled}
            disabled={requested !== null || unavailable}
            onValueChange={(next) => void toggle(next)}
          />
        </View>

        {enabled && (
          <View className="gap-3">
            <View className="gap-1">
              <Text className="text-foreground text-xl font-semibold">Lock again</Text>
              <Text className="text-tertiary text-sm">
                Choose how long you can be away before OpenBeacon asks again. It always asks when
                it’s opened after being closed. Choosing a longer time asks for your screen lock.
              </Text>
            </View>
            <ChoiceList
              accessibilityLabel="Lock again"
              options={relockOptions}
              selected={relockAfter}
              onChange={(next) => void changeRelock(next)}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default AppLockSettingsScreen;
