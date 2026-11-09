import {
  type DevicePrivateKeyMaterial,
  type HistoryPrivateKeyMaterial,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { type RouterOutputs, trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { getStoredHistoryKey } from "./historyKeys.ts";

export type EpochKeyDevice = {
  deviceId: string;
  privateKey: DevicePrivateKeyMaterial;
  userId: string;
};

export const unwrapDeviceWrap = async ({
  device,
  deviceWrap,
  epochId,
}: {
  device: EpochKeyDevice;
  deviceWrap: RouterOutputs["groupEpoch"]["getEpochKeyWraps"]["deviceWrap"];
  epochId: string;
}) => {
  if (deviceWrap?.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) return null;
  const result = await tryCatch(
    Promise.resolve().then(() =>
      unwrapEpochKey({
        recipientDeviceId: device.deviceId,
        recipientPrivateKey: device.privateKey,
        wrappedEpochKey: { ...deviceWrap, algorithm: WRAPPED_EPOCH_KEY_ALGORITHM, epochId },
      }),
    ),
  );
  return result.error ? null : result.data;
};

export const unwrapEpochKeyFromWraps = async ({
  device,
  epochId,
  getHistoryKey,
  wraps: { deviceWrap, historyWraps },
}: {
  device: EpochKeyDevice;
  epochId: string;
  getHistoryKey: (version: number) => Promise<HistoryPrivateKeyMaterial | null>;
  wraps: Pick<RouterOutputs["groupEpoch"]["getEpochKeyWraps"], "deviceWrap" | "historyWraps">;
}) => {
  const deviceEpochKey = await unwrapDeviceWrap({ device, deviceWrap, epochId });
  if (deviceEpochKey) return deviceEpochKey;

  for (const wrap of historyWraps) {
    if (wrap.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) continue;
    const historyPrivateKey = await getHistoryKey(wrap.historyKeyVersion);
    if (!historyPrivateKey) continue;
    const result = await tryCatch(
      Promise.resolve().then(() =>
        unwrapHistoryEpochKey({
          epochId,
          historyKeyVersion: wrap.historyKeyVersion,
          historyPrivateKey,
          userId: device.userId,
          wrappedEpochKey: { ...wrap, algorithm: WRAPPED_EPOCH_KEY_ALGORITHM },
        }),
      ),
    );
    if (!result.error) return result.data;
  }

  return null;
};

export const createHistoryKeyReader = (userId: string) => {
  const loaded = new Map<number, Promise<HistoryPrivateKeyMaterial | null>>();
  return (version: number) => {
    const historyKey = loaded.get(version) ?? getStoredHistoryKey({ userId, version });
    loaded.set(version, historyKey);
    return historyKey;
  };
};

export const resolveEpochKey = async ({
  device: knownDevice,
  epochId,
  groupId,
}: {
  device?: EpochKeyDevice;
  epochId: string;
  groupId: string;
}) => {
  const device = knownDevice ?? (await ensureDeviceKeyRegistration());
  const wraps = await trpcClient.groupEpoch.getEpochKeyWraps.query({
    deviceId: device.deviceId,
    epochId,
    groupId,
  });
  return unwrapEpochKeyFromWraps({
    device,
    epochId,
    getHistoryKey: (version) => getStoredHistoryKey({ userId: device.userId, version }),
    wraps,
  });
};
