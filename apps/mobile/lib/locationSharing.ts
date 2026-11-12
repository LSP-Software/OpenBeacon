import { setLocationSharingSchema } from "@openbeacon/schemas";
import type { DeviceSharingState } from "@openbeacon/shared";
import { Platform } from "react-native";
import type { z } from "zod";
import { trpcClient } from "./api.ts";
import { baseUrl } from "./base-url.ts";
import { getRegisteredDeviceKey } from "./deviceKeys.ts";
import { storage } from "./storage.ts";
import { requestTrackingSync } from "./trackingEvents.ts";

const pendingKey = (userId: string, scope: "device" | "account") =>
  `locationSharing.pending.${JSON.stringify([baseUrl, userId, scope])}`;
let changeRevision = 0;

export const hasPendingSharingPause = (userId: string) =>
  storage.getString(pendingKey(userId, "device")) !== undefined ||
  storage.getString(pendingKey(userId, "account")) !== undefined;

export const applyNativeSharingState = async (
  state: Omit<DeviceSharingState, "deviceId" | "userId">,
  userId: string,
) => {
  if (Platform.OS !== "android") return;
  const module = (await import("../modules/openbeacon-tracking/index.ts")).default;
  module.setSharingState(
    JSON.stringify([baseUrl, userId]),
    state.revisionPrefix,
    state.paused,
    state.pausedUntil?.getTime() ?? null,
    state.resumeAfter?.getTime() ?? null,
  );
};

export const syncLocationSharing = async () => {
  const revision = changeRevision;
  const device = await getRegisteredDeviceKey();
  if (!device) return;
  for (const scope of ["device", "account"] as const) {
    const key = pendingKey(device.userId, scope);
    const stored = storage.getString(key);
    if (stored) {
      const pending = setLocationSharingSchema.parse(JSON.parse(stored));
      await trpcClient.account.setLocationSharing.mutate(pending);
      if (storage.getString(key) === stored) storage.remove(key);
    }
  }
  const state = await trpcClient.account.locationSharing.query();
  if (state.deviceId !== device.deviceId || state.userId !== device.userId) return;
  if (hasPendingSharingPause(device.userId) || changeRevision !== revision) return;
  await applyNativeSharingState(state, device.userId);
  return state;
};

export const changeLocationSharing = async (input: z.infer<typeof setLocationSharingSchema>) => {
  changeRevision += 1;
  const device = await getRegisteredDeviceKey();
  if (!device) throw new Error("This device isn't registered yet.");
  const key = pendingKey(device.userId, input.scope);
  const affectsThisDevice =
    input.scope === "account" || !input.deviceId || input.deviceId === device.deviceId;
  if (input.paused && affectsThisDevice) {
    storage.set(key, JSON.stringify(input));
    await applyNativeSharingState(
      {
        paused: true,
        pausedUntil: null,
        resumeAfter: null,
        revisionPrefix: "",
      },
      device.userId,
    );
  }
  try {
    await trpcClient.account.setLocationSharing.mutate(input);
    if (affectsThisDevice) storage.remove(key);
    await syncLocationSharing();
  } finally {
    requestTrackingSync();
  }
};
