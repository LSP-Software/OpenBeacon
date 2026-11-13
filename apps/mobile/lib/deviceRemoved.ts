import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { endSession } from "./endSession.ts";

let removal: Promise<void> | null = null;
let showRemovedScreen = true;

const wipeOnce = ({ removedHere }: { removedHere: boolean }) => {
  if (removedHere) showRemovedScreen = false;
  removal ??= (async () => {
    await endSession({ reason: "phoneRemoved" });
    if (showRemovedScreen)
      await tryCatch(Promise.resolve().then(() => router.replace("/device-removed")));
  })().finally(() => {
    removal = null;
    showRemovedScreen = true;
  });
  return removal;
};

export const handleDeviceRemoved = () => wipeOnce({ removedHere: false });

export const wipeAfterRemovingThisPhone = () => wipeOnce({ removedHere: true });

export const isWipingThisPhone = () => removal !== null;
