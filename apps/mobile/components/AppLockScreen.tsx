import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AccessibilityInfo, BackHandler, Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert } from "../lib/alert.ts";
import { startAppLock, unlockApp, useAppLock } from "../lib/appLock.ts";
import { BeaconIcon } from "./BeaconIcon.tsx";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";

export const AppLockScreen = () => {
  const { locked, away, promptRequest } = useAppLock();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [lockedOut, setLockedOut] = useState(false);
  const [mounted, setMounted] = useState(false);
  const prompting = locked && !away;

  useEffect(() => {
    startAppLock();
    setMounted(true);
  }, []);

  const unlock = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setLockedOut(false);
    const result = await unlockApp();
    inFlight.current = false;
    setPending(false);
    setLockedOut(result === "lockedOut");
    if (result === "noScreenLock") {
      Alert.alert(
        "App lock is off",
        "This phone no longer has a screen lock, so OpenBeacon can’t lock. Set a screen lock in your phone’s settings, then turn on app lock again.",
      );
    }
  };

  const promptToUnlock = useEffectEvent((_promptRequest: number) => {
    if (!prompting) return;
    AccessibilityInfo.announceForAccessibility("OpenBeacon is locked");
    void unlock();
  });

  useEffect(() => {
    promptToUnlock(promptRequest);
  }, [promptRequest]);

  if (!locked && !away) return null;

  return (
    <View className="absolute inset-0 bg-background">
      <Modal
        visible={mounted}
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => {
          if (prompting) BackHandler.exitApp();
        }}
      >
        <SafeAreaView className="flex-1 bg-background">
          {prompting ? (
            <ScrollView contentContainerClassName="flex-grow justify-center gap-10 px-8 py-10">
              <View className="items-center gap-6">
                <BeaconIcon size={96} />
                <View className="gap-3">
                  <Text className="text-center text-3xl font-bold" accessibilityRole="header">
                    OpenBeacon is locked
                  </Text>
                  <Text className="text-tertiary text-center text-base leading-6">
                    Use your face, fingerprint or screen lock.
                  </Text>
                  {lockedOut && (
                    <Text
                      className="text-destructive-text text-center text-base leading-6"
                      accessibilityLiveRegion="polite"
                    >
                      Too many tries. Wait a moment, then try again.
                    </Text>
                  )}
                </View>
              </View>
              <Button onPress={() => void unlock()} disabled={pending}>
                <Text>Unlock</Text>
              </Button>
            </ScrollView>
          ) : (
            <View className="flex-1 items-center justify-center">
              <BeaconIcon size={96} />
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
};
