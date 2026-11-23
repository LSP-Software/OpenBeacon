import { tryCatch } from "@openbeacon/shared";
import { useSyncExternalStore } from "react";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import { Alert } from "./alert.ts";

let enabled: boolean | null = null;
const listeners = new Set<() => void>();

const readEnabled = () => {
  if (enabled === null) {
    try {
      enabled = OpenBeaconTracking.isLowPowerMode() === true;
    } catch {
      enabled = false;
    }
  }
  return enabled;
};

export const setLowPowerMode = async (next: boolean) => {
  const saved = await tryCatch((async () => OpenBeaconTracking.setLowPowerMode(next))());
  if (saved.error) {
    Alert.alert("Couldn’t change Save battery while moving", "Try again.");
    return;
  }
  enabled = next;
  for (const listener of listeners) listener();
};

export const useLowPowerMode = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, readEnabled);
