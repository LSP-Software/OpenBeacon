import { tryCatch } from "@openbeacon/shared";
import { Platform } from "react-native";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import { Alert } from "./alert.ts";
import { createNativeSetting } from "./nativeSetting.ts";
import type { DistanceUnit } from "./units.ts";

const noQuietGroups: readonly string[] = [];
const quietGroups = createNativeSetting<readonly string[]>(
  () => OpenBeaconTracking.quietDriveGroups() ?? noQuietGroups,
  noQuietGroups,
);
const recordedNoticeOn = createNativeSetting(
  () => OpenBeaconTracking.isDriveRecordedNoticeOn() !== false,
  true,
);

export const useTellsGroup = (groupId: string) => !quietGroups.use().includes(groupId);

export const useQuietDriveGroups = quietGroups.use;

export const setTellGroup = async (groupId: string, tell: boolean) => {
  const saved = await tryCatch((async () => OpenBeaconTracking.setTellGroup(groupId, tell))());
  if (saved.error) {
    Alert.alert("Couldn’t change Drive alerts", "Try again.");
    return;
  }
  quietGroups.update(null);
};

export const useDriveRecordedNotice = recordedNoticeOn.use;

export const setDriveRecordedNotice = async (on: boolean) => {
  const saved = await tryCatch((async () => OpenBeaconTracking.setDriveRecordedNotice(on))());
  if (saved.error) {
    Alert.alert("Couldn’t change this notice", "Try again.");
    return;
  }
  recordedNoticeOn.update(on);
};

export const syncDriveDistanceUnit = (unit: DistanceUnit) => {
  if (Platform.OS !== "android") return;
  void tryCatch((async () => OpenBeaconTracking.setDriveDistanceUnit(unit))());
};
