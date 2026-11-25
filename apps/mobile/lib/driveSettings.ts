import { tryCatch } from "@openbeacon/shared";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import { Alert } from "./alert.ts";
import type { DistanceUnit } from "./units.ts";

const listeners = new Set<() => void>();
let quietGroups: readonly string[] | null = null;
let recordedNoticeOn: boolean | null = null;
const noQuietGroups: readonly string[] = [];

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const changed = () => {
  for (const listener of listeners) listener();
};

const readQuietGroups = () => {
  if (quietGroups === null) {
    try {
      quietGroups = OpenBeaconTracking.quietDriveGroups() ?? noQuietGroups;
    } catch {
      quietGroups = noQuietGroups;
    }
  }
  return quietGroups;
};

const readRecordedNotice = () => {
  if (recordedNoticeOn === null) {
    try {
      recordedNoticeOn = OpenBeaconTracking.isDriveRecordedNoticeOn() !== false;
    } catch {
      recordedNoticeOn = true;
    }
  }
  return recordedNoticeOn;
};

export const useTellsGroup = (groupId: string) =>
  !useSyncExternalStore(subscribe, readQuietGroups).includes(groupId);

export const useQuietDriveGroups = () => useSyncExternalStore(subscribe, readQuietGroups);

export const setTellGroup = async (groupId: string, tell: boolean) => {
  const saved = await tryCatch((async () => OpenBeaconTracking.setTellGroup(groupId, tell))());
  if (saved.error) {
    Alert.alert("Couldn’t change Drive alerts", "Try again.");
    return;
  }
  quietGroups = null;
  changed();
};

export const useDriveRecordedNotice = () => useSyncExternalStore(subscribe, readRecordedNotice);

export const setDriveRecordedNotice = async (on: boolean) => {
  const saved = await tryCatch((async () => OpenBeaconTracking.setDriveRecordedNotice(on))());
  if (saved.error) {
    Alert.alert("Couldn’t change this notice", "Try again.");
    return;
  }
  recordedNoticeOn = on;
  changed();
};

export const syncDriveDistanceUnit = (unit: DistanceUnit) => {
  if (Platform.OS !== "android") return;
  void tryCatch((async () => OpenBeaconTracking.setDriveDistanceUnit(unit))());
};
