import { trpcClient } from "./api.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { isCursorAfter } from "./mapTracking.ts";
import { createMapTrackingDecryptPoint } from "./mapTrackingDecrypt.ts";
import type { MapTrackingDeps, MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";
import { notifyGroupEpochChange } from "./trackingEvents.ts";

export const createDefaultMapTrackingDeps = (): MapTrackingDeps => {
  const observedEpochs = new Map<string, MapTrackingEncryptedPoint>();
  const decryptPoint = createMapTrackingDecryptPoint({ resolveEpochKey });

  return {
    clearEpochKeys: (groupId) => {
      if (groupId) {
        observedEpochs.delete(groupId);
        decryptPoint.clearGroup(groupId);
        return;
      }
      observedEpochs.clear();
      decryptPoint.clear();
    },
    decryptPoint: async (input) => {
      const result = await decryptPoint(input);
      const observed = observedEpochs.get(input.groupId);
      if (result.status !== "ok" || (observed && !isCursorAfter(input.point, observed))) {
        return result;
      }
      observedEpochs.set(input.groupId, input.point);
      if (observed?.epochId !== input.point.epochId) {
        notifyGroupEpochChange(input.groupId);
      }
      return result;
    },
    getLatest: async (groupId, signal) =>
      trpcClient.groupTracking.getLatest.query({ groupId }, { signal }),
    listGroups: async (signal) => trpcClient.groupMembership.list.query(undefined, { signal }),
    now: () => Date.now(),
    poll: async (input, signal) => trpcClient.groupTracking.poll.query(input, { signal }),
    schedule: (callback, delayMs) => {
      const timeoutId = setTimeout(callback, delayMs);
      return {
        cancel: () => {
          clearTimeout(timeoutId);
        },
      };
    },
  };
};
