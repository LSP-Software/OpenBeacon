import { tryCatch } from "@openbeacon/shared";
import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { resolveUsableDeviceHeading } from "../lib/resolveUsableDeviceHeading.ts";

export const useSelfDeviceHeading = (enabled: boolean) => {
  const isFocused = useIsFocused();
  const [headingDegrees, setHeadingDegrees] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !isFocused) {
      return;
    }

    let cancelled = false;
    let starting = false;
    let subscription: Location.LocationSubscription | null = null;

    const startWatching = async () => {
      if (cancelled || starting || subscription) {
        return;
      }

      starting = true;
      const permissionResult = await tryCatch(Location.getForegroundPermissionsAsync());
      if (permissionResult.error || !permissionResult.data.granted || cancelled || subscription) {
        starting = false;
        return;
      }

      const watchResult = await tryCatch(
        Location.watchHeadingAsync((heading) => {
          const next = resolveUsableDeviceHeading(heading);
          setHeadingDegrees((previous) => {
            if (next === null) {
              return null;
            }

            const rounded = Math.round(next);
            return previous === rounded ? previous : rounded;
          });
        }),
      );
      starting = false;

      if (watchResult.error || cancelled) {
        watchResult.data?.remove();
        return;
      }

      subscription = watchResult.data;
    };

    const syncActive = () => {
      if (AppState.currentState !== "active") {
        subscription?.remove();
        subscription = null;
        return;
      }

      if (!subscription && !starting) {
        void startWatching();
      }
    };

    syncActive();
    const appStateSubscription = AppState.addEventListener("change", syncActive);

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      subscription?.remove();
      setHeadingDegrees(null);
    };
  }, [enabled, isFocused]);

  return headingDegrees;
};
