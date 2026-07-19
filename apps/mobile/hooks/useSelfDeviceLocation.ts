import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { runForegroundPermissionedWatch } from "../lib/runForegroundPermissionedWatch.ts";
import type { SelfDeviceLocation } from "../lib/selfDeviceLocation.ts";

export const useSelfDeviceLocation = (enabled: boolean) => {
  const isFocused = useIsFocused();
  const [location, setLocation] = useState<SelfDeviceLocation | null>(null);

  useEffect(() => {
    if (!enabled || !isFocused) {
      return;
    }

    return runForegroundPermissionedWatch({
      createSubscription: () =>
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
    });
  }, [enabled, isFocused]);

  return location;
};
