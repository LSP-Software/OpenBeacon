import { tryCatch } from "@openbeacon/shared";
import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { SelfDeviceLocation } from "../lib/selfDeviceLocation.ts";

export const useSelfDeviceLocation = (enabled: boolean) => {
  const isFocused = useIsFocused();
  const [location, setLocation] = useState<SelfDeviceLocation | null>(null);

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
        Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 5,
            timeInterval: 1_000,
          },
          (position) => {
            setLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              timestamp: new Date(position.timestamp).toISOString(),
            });
          },
        ),
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
    };
  }, [enabled, isFocused]);

  return location;
};
