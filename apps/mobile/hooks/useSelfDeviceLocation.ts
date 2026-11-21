import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { runForegroundPermissionedWatch } from "../lib/runForegroundPermissionedWatch.ts";
import type { SelfDeviceLocation } from "../lib/selfDeviceLocation.ts";
import { watchPositionWithLastKnown } from "../lib/watchPositionWithLastKnown.ts";

export const useSelfDeviceLocation = (enabled: boolean) => {
  const isFocused = useIsFocused();
  const [location, setLocation] = useState<SelfDeviceLocation | null>(null);

  useEffect(() => {
    if (!enabled || !isFocused) {
      setLocation(null);
      return;
    }

    return runForegroundPermissionedWatch({
      createSubscription: (isWanted) =>
        watchPositionWithLastKnown({
          getLastKnownPosition: () =>
            Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 100 }),
          isWanted,
          onPosition: (position) => {
            setLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              timestamp: new Date(position.timestamp).toISOString(),
            });
          },
          watchPosition: (onPosition) =>
            Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.High,
                distanceInterval: 5,
                timeInterval: 1_000,
                mayShowUserSettingsDialog: false,
              },
              onPosition,
            ),
        }),
      onInactive: () => {
        setLocation(null);
      },
    });
  }, [enabled, isFocused]);

  return location;
};
