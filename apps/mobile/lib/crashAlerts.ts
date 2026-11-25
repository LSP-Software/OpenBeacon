import { tryCatch } from "@openbeacon/shared";
import { useSyncExternalStore } from "react";
import { Linking, Platform } from "react-native";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import { Alert } from "./alert.ts";
import type { SpeedUnit } from "./units.ts";

let on: boolean | null = null;
const listeners = new Set<() => void>();

const readOn = () => {
  if (on === null) {
    try {
      on = OpenBeaconTracking.isCrashAlertsOn() !== false;
    } catch {
      on = true;
    }
  }
  return on;
};

export const useCrashAlerts = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, readOn);

export const setCrashAlerts = async (next: boolean) => {
  const saved = await tryCatch((async () => OpenBeaconTracking.setCrashAlerts(next))());
  if (saved.error) {
    Alert.alert("Couldn’t change Crash alerts", "Try again.");
    return;
  }
  on = next;
  for (const listener of listeners) listener();
};

export const localEmergencyNumber = () => {
  try {
    return OpenBeaconTracking.emergencyNumber();
  } catch {
    return null;
  }
};

export const tryCrashCountdown = async () => {
  const started = await tryCatch((async () => OpenBeaconTracking.startCrashTest())());
  if (started.error) Alert.alert("Couldn’t start the test", "Try again.");
};

export const syncCrashAlertContext = (
  groups: { id: string; name: string }[],
  speedUnit: SpeedUnit,
) => {
  if (Platform.OS !== "android") return;
  void tryCatch(
    (async () =>
      OpenBeaconTracking.setCrashAlertContext(
        Object.fromEntries(groups.map((group) => [group.id, group.name])),
        speedUnit,
      ))(),
  );
};

export const joinGroupNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "your groups")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export const openPhoneSafetySettings = async () => {
  const opened = await tryCatch(Linking.sendIntent("android.settings.SAFETY_CENTER"));
  if (opened.error) await tryCatch(Linking.openSettings());
};
