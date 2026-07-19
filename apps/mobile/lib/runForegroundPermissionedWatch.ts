import { tryCatch } from "@openbeacon/shared";
import * as Location from "expo-location";
import { AppState } from "react-native";

export const runForegroundPermissionedWatch = ({
  createSubscription,
  onInactive,
}: {
  createSubscription: () => Promise<Location.LocationSubscription>;
  onInactive?: () => void;
}) => {
  let cancelled = false;
  let starting = false;
  let subscription: Location.LocationSubscription | null = null;

  const stopSubscription = () => {
    subscription?.remove();
    subscription = null;
    onInactive?.();
  };

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

    const watchResult = await tryCatch(createSubscription());
    starting = false;

    if (watchResult.error || cancelled || AppState.currentState !== "active") {
      watchResult.data?.remove();
      return;
    }

    subscription = watchResult.data;
  };

  const syncActive = () => {
    if (AppState.currentState !== "active") {
      stopSubscription();
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
    stopSubscription();
  };
};
