import {
  type DevicePrivateKeyMaterial,
  unwrapEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  type WrappedEpochKey,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";

export const checkGroupKeyAccess = async ({
  groupId,
  ensureDeviceKeys,
  getLatestEpoch,
  getWrappedKey,
}: {
  groupId: string;
  ensureDeviceKeys: () => Promise<{ deviceId: string; privateKey: DevicePrivateKeyMaterial }>;
  getLatestEpoch: (groupId: string) => Promise<{ epochId: string } | null>;
  getWrappedKey: (input: {
    groupId: string;
    epochId: string;
    deviceId: string;
  }) => Promise<WrappedEpochKey | null>;
}) => {
  const [device, epoch] = await Promise.all([ensureDeviceKeys(), getLatestEpoch(groupId)]);
  if (!epoch) return "unavailable" as const;

  const wrapped = await getWrappedKey({
    groupId,
    epochId: epoch.epochId,
    deviceId: device.deviceId,
  });
  if (!wrapped || wrapped.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) return "missing" as const;

  const result = await tryCatch(
    Promise.resolve().then(() =>
      unwrapEpochKey({
        recipientDeviceId: device.deviceId,
        recipientPrivateKey: device.privateKey,
        wrappedEpochKey: wrapped,
      }),
    ),
  );
  return result.error ? ("missing" as const) : ("available" as const);
};
