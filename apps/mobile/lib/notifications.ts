import { tryCatch } from "@openbeacon/shared";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useState } from "react";
// biome-ignore lint/correctness/useReactNativePlatformComponents: imports must end in .ts, so Metro cannot pick a .android.ts file; the Android call is guarded by Platform.OS
import { AppState, PermissionsAndroid, Platform } from "react-native";
import appConfig from "../app.json";
import type { NoticeSlot } from "../modules/openbeacon-tracking/index.ts";
import type { ApiCompatibilityProblem } from "./apiCompatibility.ts";
import { loadTrackingModule } from "./trackingModule.ts";
import { useSingleFlight } from "./useSingleFlight.ts";

export const showNotice = async (
  notice:
    | { kind: "compatibility"; problem: ApiCompatibilityProblem; selfHosted: boolean }
    | { kind: "deviceRemoved" }
    | { kind: "signedOut" },
): Promise<boolean> => {
  if (AppState.currentState === "active") return false;
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return false;
  const kind =
    notice.kind !== "compatibility"
      ? notice.kind
      : notice.problem === "serverTooOld" && notice.selfHosted
        ? "selfHostedServerTooOld"
        : notice.problem;
  const result = await tryCatch(Promise.resolve().then(() => trackingModule.showNotice(kind)));
  return result.data ?? false;
};

export const dismissNotice = async (slot: NoticeSlot) => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return;
  await tryCatch(Promise.resolve().then(() => trackingModule.dismissNotice(slot)));
};

export const useDismissNoticesWhenOpened = () => {
  useEffect(() => {
    const dismiss = () => {
      void dismissNotice("sharingChanged");
      void dismissNotice("signedOut");
    };
    dismiss();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") dismiss();
    });
    return () => subscription.remove();
  }, []);
};

export const areNotificationsEnabled = async (): Promise<boolean> => {
  const trackingModule = await loadTrackingModule();
  return trackingModule?.areNotificationsEnabled() ?? true;
};

export const requestNotificationPermissions = async (): Promise<
  "granted" | "denied" | "blocked"
> => {
  if (Platform.OS !== "android") return "granted";
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (Number(Platform.Version) >= 33 && !(await PermissionsAndroid.check(permission))) {
    const dialogWasShownBefore =
      (await loadTrackingModule())?.shouldShowNotificationRationale() ?? false;
    const result = await PermissionsAndroid.request(permission);
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN && !dialogWasShownBefore) {
      return "blocked";
    }
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return "denied";
  }
  return (await areNotificationsEnabled()) ? "granted" : "blocked";
};

export const turnOnNotifications = async () => {
  const permission = await tryCatch(requestNotificationPermissions());
  if (permission.data !== "blocked") return;
  const opened = await tryCatch(
    Linking.sendIntent("android.settings.APP_NOTIFICATION_SETTINGS", [
      { key: "android.provider.extra.APP_PACKAGE", value: appConfig.expo.android.package },
    ]),
  );
  if (opened.error) await tryCatch(Linking.openSettings());
};

export const useNotificationSettings = () => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const turningOn = useSingleFlight<"turnOn">();

  const refresh = useCallback(async () => {
    const result = await tryCatch(areNotificationsEnabled());
    if (!result.error) setEnabled(result.data);
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const turnOn = () =>
    turningOn.run("turnOn", async () => {
      await turnOnNotifications();
      await refresh();
    });

  return { enabled, turnOn, turningOn: turningOn.isPending };
};
