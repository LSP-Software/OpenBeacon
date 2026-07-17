import { WRAPPED_EPOCH_KEY_ALGORITHM, type WrappedEpochKey } from "@openbeacon/encryption";
import { trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { createMapTrackingDecryptPoint } from "./mapTrackingDecrypt.ts";
import type { MapTrackingDeps } from "./mapTrackingTypes.ts";

export const createDefaultMapTrackingDeps = (): MapTrackingDeps => ({
  decryptPoint: createMapTrackingDecryptPoint({
    ensureDeviceKeys: ensureDeviceKeyRegistration,
    getWrappedEpochKey: async ({ deviceId, epochId, groupId }) => {
      const wrappedEpochKey = await trpcClient.groupEpoch.getWrappedKey.query({
        deviceId,
        epochId,
        groupId,
      });

      if (!wrappedEpochKey || wrappedEpochKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
        return null;
      }

      return {
        ...wrappedEpochKey,
        algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      } satisfies WrappedEpochKey;
    },
  }),
  getLatest: async (groupId) => trpcClient.groupTracking.getLatest.query({ groupId }),
  listGroups: async () => trpcClient.groupMembership.list.query(),
  now: () => Date.now(),
  poll: async ({ cursor, groupId, limit }) =>
    trpcClient.groupTracking.poll.query({
      cursor,
      groupId,
      limit,
    }),
  schedule: (callback, delayMs) => {
    const timeoutId = setTimeout(callback, delayMs);
    return {
      cancel: () => {
        clearTimeout(timeoutId);
      },
    };
  },
});
