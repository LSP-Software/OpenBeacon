import { openDeviceActivationChallenge } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { router } from "expo-router";
import { trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration, getDeviceActiveKey } from "./deviceKeys.ts";
import { getStoredHistoryKey } from "./historyKeys.ts";
import { deleteSavedDeviceLink } from "./savedDeviceLink.ts";
import { linkSessionToDevice } from "./sessionLink.ts";
import { storage } from "./storage.ts";

export const ACTIVATION_KEY_MISSING_MESSAGE =
  "This phone doesn't have your account's current history key, so it can't be set up this way.";

export const markThisDeviceActive = (deviceId: string) => {
  storage.set(getDeviceActiveKey(deviceId), true);
};

export const isThisDeviceActive = async () => {
  const device = await ensureDeviceKeyRegistration();
  if (storage.getBoolean(getDeviceActiveKey(device.deviceId))) return true;
  const status = await trpcClient.device.status.query();
  if (!status.registered) await linkSessionToDevice(device);
  const { activated } = status.registered ? status : await trpcClient.device.status.query();
  if (activated) markThisDeviceActive(device.deviceId);
  return activated;
};

export const activateWithHistoryKey = async () => {
  const device = await ensureDeviceKeyRegistration();
  const challenge = await trpcClient.device.activationChallenge.mutate();
  const historyPrivateKey = await getStoredHistoryKey({
    userId: device.userId,
    version: challenge.historyKeyVersion,
  });
  if (!historyPrivateKey) throw new Error(ACTIVATION_KEY_MISSING_MESSAGE);
  const answer = await tryCatch(
    Promise.resolve().then(() =>
      openDeviceActivationChallenge({
        deviceId: device.deviceId,
        historyPrivateKey,
        sealed: challenge.sealed,
        userId: device.userId,
      }),
    ),
  );
  if (answer.error) throw new Error(ACTIVATION_KEY_MISSING_MESSAGE);
  await trpcClient.device.activate.mutate({ answer: answer.data });
  markThisDeviceActive(device.deviceId);
  await tryCatch(deleteSavedDeviceLink(device));
};

let lastSetupRedirect = 0;

export const handleDevicePending = () => {
  if (Date.now() - lastSetupRedirect < 10_000) return;
  lastSetupRedirect = Date.now();
  void tryCatch(Promise.resolve().then(() => router.replace("/setup")));
};
