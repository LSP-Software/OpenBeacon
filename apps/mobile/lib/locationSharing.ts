import { setLocationSharingSchema } from "@openbeacon/schemas";
import { tryCatch, type DeviceSharingState } from "@openbeacon/shared";
import { Platform } from "react-native";
import { z } from "zod";
import { trpcClient } from "./api.ts";
import { baseUrl } from "./base-url.ts";
import { createSecureId } from "./createSecureId.ts";
import { getRegisteredDeviceKey, getStoredDeviceId } from "./deviceKeys.ts";
import { storage } from "./storage.ts";
import { requestTrackingSync } from "./trackingEvents.ts";

const pendingKey = (userId: string, scope: "device" | "account") =>
  `locationSharing.pending.${JSON.stringify([baseUrl, userId, scope])}`;
const localPauseKey = (userId: string, deviceId: string) =>
  `locationSharing.localPause.${JSON.stringify([baseUrl, userId, deviceId])}`;
const pendingChangeSchema = z.object({ requestId: z.string(), input: setLocationSharingSchema });
const scheduledChanges = new Set<string>();
let changeRevision = 0;
let operationQueue: Promise<unknown> = Promise.resolve();

const queueOperation = <T>(operation: () => Promise<T>) => {
  const task = operationQueue.then(operation, operation);
  operationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

const readPendingChange = (userId: string, scope: "device" | "account") => {
  const stored = storage.getString(pendingKey(userId, scope));
  return stored ? { stored, ...pendingChangeSchema.parse(JSON.parse(stored)) } : null;
};

export const getPendingSharingChanges = (userId: string) => ({
  device: readPendingChange(userId, "device")?.input ?? null,
  account: readPendingChange(userId, "account")?.input ?? null,
});

export const hasPendingSharingPause = (userId: string) =>
  storage.getString(pendingKey(userId, "device")) !== undefined ||
  storage.getString(pendingKey(userId, "account")) !== undefined;

export const hasLocallyPausedSharing = (userId: string) => {
  const deviceId = getStoredDeviceId(userId);
  return Boolean(deviceId && storage.getString(localPauseKey(userId, deviceId)) === "true");
};

const applyNativeSharingState = async (state: DeviceSharingState, isCurrent: () => boolean) => {
  if (Platform.OS !== "android") return false;
  const module = (await import("../modules/openbeacon-tracking/index.ts")).default;
  if (!isCurrent()) return false;
  const applied = module.setSharingState(
    JSON.stringify([baseUrl, state.userId]),
    state.deviceId,
    state.revisionPrefix,
    state.paused,
    state.pausedUntil?.getTime() ?? null,
    state.resumeAfter?.getTime() ?? null,
  );
  if (applied) {
    const key = localPauseKey(state.userId, state.deviceId);
    if (state.paused) storage.set(key, "true");
    else storage.remove(key);
  }
  return applied;
};

const synchronizeSharing = async () => {
  const revision = changeRevision;
  const device = await getRegisteredDeviceKey();
  if (!device) return;
  for (const scope of ["device", "account"] as const) {
    const pending = readPendingChange(device.userId, scope);
    if (!pending || scheduledChanges.has(pending.requestId)) continue;
    const key = pendingKey(device.userId, scope);
    if (pending.input.scope === "device" && pending.input.deviceId !== device.deviceId) {
      if (storage.getString(key) === pending.stored) storage.remove(key);
      continue;
    }
    await trpcClient.account.setLocationSharing.mutate(pending.input);
    if (storage.getString(key) === pending.stored) storage.remove(key);
  }
  const state = await trpcClient.account.locationSharing.query();
  if (state.deviceId !== device.deviceId || state.userId !== device.userId) return;
  const isCurrent = () => !hasPendingSharingPause(device.userId) && changeRevision === revision;
  await applyNativeSharingState(state, isCurrent);
  return state;
};

export const syncLocationSharing = () => queueOperation(synchronizeSharing);

export const changeLocationSharing = async (
  input: Omit<z.infer<typeof setLocationSharingSchema>, "expectedUserId" | "deviceId"> & {
    deviceId?: string;
  },
) => {
  const revision = ++changeRevision;
  const device = await getRegisteredDeviceKey();
  if (!device) throw new Error("This device isn't registered yet.");
  const change = setLocationSharingSchema.parse({
    ...input,
    expectedUserId: device.userId,
    ...(input.scope === "device" ? { deviceId: input.deviceId ?? device.deviceId } : {}),
  });
  const key = pendingKey(device.userId, change.scope);
  const affectsThisDevice = change.scope === "account" || change.deviceId === device.deviceId;
  const requestId = createSecureId("sharing");
  const stored = JSON.stringify({ requestId, input: change });
  const previous = storage.getString(key);
  scheduledChanges.add(requestId);
  try {
    if (change.paused && affectsThisDevice) {
      storage.set(key, stored);
      await applyNativeSharingState(
        {
          deviceId: device.deviceId,
          userId: device.userId,
          paused: true,
          pausedUntil: null,
          resumeAfter: null,
          revisionPrefix: "",
        },
        () => revision === changeRevision,
      );
    }
    await queueOperation(async () => {
      await trpcClient.account.setLocationSharing.mutate(change);
      const pending = storage.getString(key);
      if (affectsThisDevice && pending === (change.paused ? stored : previous)) storage.remove(key);
      await tryCatch(synchronizeSharing());
    });
  } finally {
    scheduledChanges.delete(requestId);
    requestTrackingSync();
  }
};
