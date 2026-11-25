import { tryCatch } from "@openbeacon/shared";
import { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import { useAppForeground } from "../hooks/useAppForeground.ts";
import { type AppUpdate, findAppUpdate, skipAppUpdate } from "../lib/appUpdate.ts";
import { useAppLock } from "../lib/appLock.ts";
import { appVersion } from "../lib/versions.ts";
import { useApiCompatibilityGateShown } from "./ApiCompatibilityGate.tsx";
import { BottomSheet } from "./ui/BottomSheet.tsx";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";

let offeredThisLaunch = false;

export const AppUpdateSheet = () => {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [starting, setStarting] = useState(false);
  const { locked, away } = useAppLock();
  const compatibilityGateShown = useApiCompatibilityGateShown();
  const checking = useRef(false);

  const check = async () => {
    if (offeredThisLaunch || checking.current) return;
    checking.current = true;
    const found = await tryCatch(findAppUpdate());
    checking.current = false;
    if (found.error || !found.data || offeredThisLaunch) return;
    offeredThisLaunch = true;
    setUpdate(found.data);
  };

  useEffect(() => {
    void check();
  }, []);

  useAppForeground(() => void check());

  const startUpdate = async () => {
    if (!update) return;
    setStarting(true);
    await update.start();
    setStarting(false);
    setUpdate(null);
  };

  const notNow = () => {
    if (update) skipAppUpdate(update);
    setUpdate(null);
  };

  const shown = update !== null && !locked && !away && !compatibilityGateShown;

  return (
    <BottomSheet
      visible={shown}
      onClose={() => {
        if (shown) notNow();
      }}
    >
      {update ? (
        <View className="gap-5">
          <View className="gap-2">
            <Image
              source={require("../assets/icon.png")}
              accessibilityIgnoresInvertColors
              className="mb-2 size-16 rounded-2xl"
            />
            <Text accessibilityRole="header" className="text-2xl font-bold">
              Update OpenBeacon
            </Text>
            <Text className="text-secondary">A new version is ready on {update.store}.</Text>
          </View>
          <View className="rounded-2xl bg-card px-4">
            <View className="flex-row justify-between py-3">
              <Text className="text-secondary">You have</Text>
              <Text className="font-medium">{appVersion}</Text>
            </View>
            {update.latestVersion ? (
              <View className="flex-row justify-between border-t border-border py-3">
                <Text className="text-secondary">Latest</Text>
                <Text className="font-medium">{update.latestVersion}</Text>
              </View>
            ) : null}
          </View>
          <View className="gap-2">
            <Button loading={starting} onPress={() => void startUpdate()}>
              <Text>Update</Text>
            </Button>
            <Button variant="ghost" disabled={starting} onPress={notNow}>
              <Text>Not now</Text>
            </Button>
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
};
