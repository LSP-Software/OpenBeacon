import { tryCatch } from "@openbeacon/shared";
import { useEffect } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import type { ApiCompatibilityProblem } from "./apiCompatibility.ts";

const loadTrackingModule = async () =>
  Platform.OS === "android"
    ? (await import("../modules/openbeacon-tracking/index.ts")).default
    : null;

export const showNotice = async (
  notice:
    | { kind: "compatibility"; problem: ApiCompatibilityProblem; selfHosted: boolean }
    | { kind: "deviceRemoved" }
    | { kind: "signedOut" },
): Promise<boolean> => {
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

export const dismissNotice = async (
  slot: "compatibility" | "locationPermission" | "signedOut" | "sharingChanged",
) => {
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
    const result = await PermissionsAndroid.request(permission);
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return "blocked";
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return "denied";
  }
  return (await areNotificationsEnabled()) ? "granted" : "blocked";
};
