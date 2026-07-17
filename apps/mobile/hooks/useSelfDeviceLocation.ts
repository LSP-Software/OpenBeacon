import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

export const useSelfDeviceLocation = (enabled: boolean) => {
  const isFocused = useIsFocused();
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    timestamp: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !isFocused) {
      return;
    }

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const startWatching = async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted || cancelled) {
        return;
      }

      subscription = await Location.watchPositionAsync(
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
      );
    };

    const syncActive = () => {
      if (AppState.currentState !== "active") {
        subscription?.remove();
        subscription = null;
        return;
      }

      if (!subscription) {
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
