import { PermissionsAndroid, Platform } from "react-native";

export const requestNotificationPermissionsForLaunch = async (): Promise<boolean> => {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) {
    return true;
  }

  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) {
    return true;
  }

  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
};
