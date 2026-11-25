import { tryCatch } from "@openbeacon/shared";
import { useSyncExternalStore } from "react";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import { Alert } from "./alert.ts";
import { deleteDrivesEverywhere } from "./deleteDrives.ts";
import { trpcClient } from "./api.ts";
import { thisDeviceNoun } from "./thisDeviceNoun.ts";
import { deleteSpeedLimitData } from "./speedLimitPacks.ts";
import { getOwner } from "./tracking.ts";

let on: boolean | null = null;
const listeners = new Set<() => void>();

const readOn = () => {
  if (on === null) {
    try {
      on = OpenBeaconTracking.isDriveDetectionOn() !== false;
    } catch {
      on = true;
    }
  }
  return on;
};

const offerToDeleteDrives = async (userId: string) => {
  const owner = getOwner(userId);
  const listed = await tryCatch(OpenBeaconTracking.listDriveIds(owner));
  const driveIds = listed.data ?? [];
  if (driveIds.length === 0) return;
  Alert.alert(
    "Delete your past drives?",
    driveIds.length === 1
      ? `Your groups can still see the drive this ${thisDeviceNoun()} recorded. Deleting removes it for everyone, for good.`
      : `Your groups can still see the ${driveIds.length} drives this ${thisDeviceNoun()} recorded. Deleting removes them for everyone, for good.`,
    [
      { text: "Keep drives", style: "cancel" },
      {
        text: "Delete drives",
        style: "destructive",
        onPress: () =>
          void deleteDrivesEverywhere({
            driveIds,
            deleteOnServer: (batch) => trpcClient.drives.delete.mutate({ driveIds: batch }),
            deleteHere: (batch) => OpenBeaconTracking.deleteDrives(owner, batch),
          }).then((deleted) => {
            if (!deleted) {
              Alert.alert("Couldn’t delete your drives", "Check your connection and try again.");
            }
          }),
      },
    ],
  );
};

export const setDriveDetection = async (next: boolean, userId: string | undefined) => {
  const saved = await tryCatch((async () => OpenBeaconTracking.setDriveDetection(next))());
  if (saved.error) {
    Alert.alert("Couldn’t change Drive detection", "Try again.");
    return;
  }
  on = next;
  for (const listener of listeners) listener();
  if (!next) await tryCatch(deleteSpeedLimitData());
  if (!next && userId) await offerToDeleteDrives(userId);
};

export const useDriveDetection = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, readOn);
