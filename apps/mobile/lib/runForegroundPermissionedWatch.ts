import * as Location from "expo-location";
import { AppState } from "react-native";
import { runForegroundPermissionedWatchCore } from "./runForegroundPermissionedWatchCore.ts";

export const runForegroundPermissionedWatch = ({
  createSubscription,
  onInactive,
}: {
  createSubscription: () => Promise<Location.LocationSubscription>;
  onInactive?: () => void;
}) =>
  runForegroundPermissionedWatchCore({
    createSubscription,
    getAppState: () => AppState.currentState,
    getForegroundPermissions: () => Location.getForegroundPermissionsAsync(),
    ...(onInactive ? { onInactive } : {}),
    subscribeAppState: (listener) => AppState.addEventListener("change", listener),
  });
