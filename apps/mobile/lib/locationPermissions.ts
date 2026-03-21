import type { LocationPermissionResponse as ExpoLocationPermissionResponse } from "expo-location";
import {
  getBackgroundPermissionsAsync,
  getForegroundPermissionsAsync,
  requestBackgroundPermissionsAsync,
  requestForegroundPermissionsAsync,
} from "expo-location";

export type LocationPermissionStatus = "granted" | "denied" | "undetermined";

export type LocationPermissionRequirement = "foreground" | "background" | "precise";

type LocationPermissionResponse = {
  status: LocationPermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
  ios?: {
    scope: "whenInUse" | "always" | "none";
    accuracy: "full" | "reduced";
  };
  android?: {
    accuracy: "fine" | "coarse" | "none";
  };
};

export type LocationPermissionState = {
  foregroundStatus: LocationPermissionStatus;
  backgroundStatus: LocationPermissionStatus;
  preciseEnabled: boolean;
  isReadyForSharing: boolean;
  shouldShowAccountWarning: boolean;
  missing: LocationPermissionRequirement[];
};

const toLocationPermissionResponse = (
  permissionResponse: ExpoLocationPermissionResponse,
): LocationPermissionResponse => ({
  status: permissionResponse.status,
  granted: permissionResponse.granted,
  canAskAgain: permissionResponse.canAskAgain,
  ...(permissionResponse.ios === undefined ? {} : { ios: permissionResponse.ios }),
  ...(permissionResponse.android === undefined ? {} : { android: permissionResponse.android }),
});

const getPreciseEnabled = (foregroundPermission: LocationPermissionResponse): boolean => {
  if (!foregroundPermission.granted) {
    return false;
  }

  if (foregroundPermission.ios) {
    return foregroundPermission.ios.accuracy === "full";
  }

  if (foregroundPermission.android) {
    return foregroundPermission.android.accuracy === "fine";
  }

  return true;
};

const normalizeLocationPermissionState = ({
  foregroundPermission,
  backgroundPermission,
}: {
  foregroundPermission: LocationPermissionResponse;
  backgroundPermission: LocationPermissionResponse;
}): LocationPermissionState => {
  const missing: LocationPermissionRequirement[] =
    foregroundPermission.status !== "granted"
      ? ["foreground"]
      : [
          ...(getPreciseEnabled(foregroundPermission) ? [] : ["precise" as const]),
          ...(backgroundPermission.status === "granted" ? [] : ["background" as const]),
        ];

  return {
    foregroundStatus: foregroundPermission.status,
    backgroundStatus: backgroundPermission.status,
    preciseEnabled: getPreciseEnabled(foregroundPermission),
    isReadyForSharing: missing.length === 0,
    shouldShowAccountWarning: missing.length > 0,
    missing,
  };
};

export const getLocationPermissionWarningTitle = (
  state: Pick<LocationPermissionState, "missing">,
): string => {
  if (state.missing.length === 0) {
    return "";
  }

  if (state.missing.length === 1) {
    if (state.missing[0] === "foreground") {
      return "Location access is off";
    }

    if (state.missing[0] === "precise") {
      return "Precise location is off";
    }

    return "Background location is off";
  }

  return `${state.missing
    .map((missing) => {
      if (missing === "foreground") {
        return "Location access";
      }

      if (missing === "precise") {
        return "Precise location";
      }

      return "Background location";
    })
    .join(" and ")} are off`;
};

export const getLocationPermissionState = async (): Promise<LocationPermissionState> => {
  const [foregroundPermission, backgroundPermission] = await Promise.all([
    getForegroundPermissionsAsync(),
    getBackgroundPermissionsAsync(),
  ]);

  return normalizeLocationPermissionState({
    foregroundPermission: toLocationPermissionResponse(foregroundPermission),
    backgroundPermission: toLocationPermissionResponse(backgroundPermission),
  });
};

export const requestForegroundLocationPermissions = async (): Promise<LocationPermissionState> => {
  let foregroundPermission = await getForegroundPermissionsAsync();

  if (!foregroundPermission.granted) {
    foregroundPermission = await requestForegroundPermissionsAsync();
  }

  const backgroundPermission = await getBackgroundPermissionsAsync();

  return normalizeLocationPermissionState({
    foregroundPermission: toLocationPermissionResponse(foregroundPermission),
    backgroundPermission: toLocationPermissionResponse(backgroundPermission),
  });
};

export const requestBackgroundLocationPermissions = async (): Promise<LocationPermissionState> => {
  const foregroundPermission = await getForegroundPermissionsAsync();
  let backgroundPermission = await getBackgroundPermissionsAsync();

  if (
    foregroundPermission.granted &&
    getPreciseEnabled(toLocationPermissionResponse(foregroundPermission)) &&
    !backgroundPermission.granted
  ) {
    backgroundPermission = await requestBackgroundPermissionsAsync();
  }

  return normalizeLocationPermissionState({
    foregroundPermission: toLocationPermissionResponse(foregroundPermission),
    backgroundPermission: toLocationPermissionResponse(backgroundPermission),
  });
};

export const requestLocationPermissionsForLaunch = async (): Promise<LocationPermissionState> =>
  requestForegroundLocationPermissions();

export const openLocationSettings = async (): Promise<void> => {
  const linking = await import("expo-linking");
  await linking.openSettings();
};
