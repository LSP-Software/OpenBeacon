import {
  encodeBase64,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
  unwrapEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { Platform } from "react-native";
import type { CiphertextQueueItem } from "../modules/openbeacon-tracking/index.ts";
import { trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";

let reconcilePromise: Promise<void> | null = null;
let flushPromise: Promise<void> | null = null;
let revokePromise: Promise<void> | null = null;

const loadTrackingModule = async () => {
  if (Platform.OS !== "android") {
    return null;
  }

  return (await import("../modules/openbeacon-tracking/index.ts")).default;
};

const getProvisionedKeyIdentity = ({
  epochId,
  groupId,
  kind,
  senderDeviceId,
}: {
  epochId: string;
  groupId: string;
  kind: string;
  senderDeviceId: string;
}) => `${groupId}:${epochId}:${senderDeviceId}:${kind}`;

const haveMatchingProvisionedKeys = ({
  current,
  desired,
}: {
  current: Array<{
    epochId: string;
    groupId: string;
    kind: string;
    senderDeviceId: string;
  }>;
  desired: Array<{
    epochId: string;
    groupId: string;
    kind: string;
    senderDeviceId: string;
  }>;
}) =>
  current.map(getProvisionedKeyIdentity).sort().join("|") ===
  desired.map(getProvisionedKeyIdentity).sort().join("|");

const reconcileTrackingKeysInternal = async ({
  startCapture,
}: {
  startCapture: boolean;
}): Promise<void> => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) {
    return;
  }

  const deviceKeyContext = await ensureDeviceKeyRegistration();
  const groups = await trpcClient.groupMembership.list.query();
  const epochs = (
    await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const epoch = await trpcClient.groupEpoch.getLatest.query({ groupId });
        return epoch ? { epochId: epoch.epochId, groupId } : null;
      }),
    )
  ).filter((epoch) => epoch !== null);
  const wrappedEpochs = (
    await Promise.all(
      epochs.map(async ({ epochId, groupId }) => {
        const wrappedEpochKey = await trpcClient.groupEpoch.getWrappedKey.query({
          deviceId: deviceKeyContext.deviceId,
          epochId,
          groupId,
        });

        if (!wrappedEpochKey || wrappedEpochKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
          return null;
        }

        return {
          epochId,
          groupId,
          wrappedEpochKey: {
            ...wrappedEpochKey,
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          },
        };
      }),
    )
  ).filter((epoch) => epoch !== null);
  const desiredKeyMetadata = wrappedEpochs.map(({ epochId, groupId }) => ({
    epochId,
    groupId,
    kind: TRACKING_POINT_KIND,
    senderDeviceId: deviceKeyContext.deviceId,
  }));

  if (
    !haveMatchingProvisionedKeys({
      current: trackingModule.listProvisionedEpochKeys(),
      desired: desiredKeyMetadata,
    })
  ) {
    const keys = wrappedEpochs.map(({ epochId, groupId, wrappedEpochKey }) => {
      const epochKey = unwrapEpochKey({
        recipientDeviceId: deviceKeyContext.deviceId,
        recipientPrivateKey: deviceKeyContext.privateKey,
        wrappedEpochKey,
      });

      return {
        epochId,
        epochKeyBase64: encodeBase64(epochKey.expose()),
        groupId,
        kind: TRACKING_POINT_KIND,
        senderDeviceId: deviceKeyContext.deviceId,
      };
    });

    trackingModule.revokeEpochKeys();
    trackingModule.provisionEpochKeys(keys);
  }

  if (startCapture && desiredKeyMetadata.length > 0) {
    if (!trackingModule.isCaptureRunning()) {
      await trackingModule.startCapture();
    }
    return;
  }

  if (trackingModule.isCaptureRunning()) {
    await trackingModule.stopCapture();
  }
};

export const reconcileTrackingKeys = ({
  startCapture,
}: {
  startCapture: boolean;
}): Promise<void> => {
  if (reconcilePromise) {
    return reconcilePromise;
  }

  reconcilePromise = reconcileTrackingKeysInternal({ startCapture }).finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
};

const getRetryDelayMs = (attemptCount: number) =>
  Math.min(1_000 * 2 ** Math.max(attemptCount - 1, 0), 300_000);

const isReadyForRetry = (item: CiphertextQueueItem, now: number) =>
  item.attemptCount === 0 ||
  item.lastAttemptAt === null ||
  now - item.lastAttemptAt >= getRetryDelayMs(item.attemptCount);

const getErrorCode = (error: unknown) => {
  if (
    typeof error !== "object" ||
    error === null ||
    !("data" in error) ||
    typeof error.data !== "object" ||
    error.data === null ||
    !("code" in error.data) ||
    typeof error.data.code !== "string"
  ) {
    return null;
  }

  return error.data.code;
};

const getQueueError = (error: unknown) => {
  const code = getErrorCode(error) ?? "UNKNOWN";
  const message = error instanceof Error ? error.message : "Upload failed";
  return `${code}: ${message}`.slice(0, 160);
};

const isPermanentUploadError = (error: unknown) => {
  const code = getErrorCode(error);
  return code === "BAD_REQUEST" || code === "FORBIDDEN";
};

type UploadableQueueItem = CiphertextQueueItem & {
  algorithm: typeof PAYLOAD_ENCRYPTION_ALGORITHM;
  kind: typeof TRACKING_POINT_KIND;
};

const isUploadableQueueItem = (item: CiphertextQueueItem): item is UploadableQueueItem =>
  item.algorithm === PAYLOAD_ENCRYPTION_ALGORITHM && item.kind === TRACKING_POINT_KIND;

const uploadClaimedItems = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  items: UploadableQueueItem[],
): Promise<void> => {
  const ids = items.map(({ id }) => id);
  const uploadResult = await tryCatch(
    trpcClient.groupTracking.uploadBatch.mutate({
      groupId: items[0]?.groupId ?? "",
      points: items.map(
        ({ algorithm, ciphertext, clientPointId, epochId, kind, nonce, senderDeviceId }) => ({
          algorithm,
          ciphertext,
          clientPointId,
          epochId,
          kind,
          nonce,
          senderDeviceId,
        }),
      ),
    }),
  );

  if (uploadResult.error) {
    if (getErrorCode(uploadResult.error) === "BAD_REQUEST" && items.length > 1) {
      const midpoint = Math.ceil(items.length / 2);
      await Promise.all([
        uploadClaimedItems(trackingModule, items.slice(0, midpoint)),
        uploadClaimedItems(trackingModule, items.slice(midpoint)),
      ]);
      return;
    }
    if (isPermanentUploadError(uploadResult.error)) {
      await trackingModule.deleteCiphertexts(ids);
      return;
    }

    await trackingModule.requeueCiphertexts(ids, getQueueError(uploadResult.error));
    return;
  }

  const completedClientPointIds = new Set([
    ...uploadResult.data.accepted,
    ...uploadResult.data.duplicates,
  ]);
  const completedIds = items
    .filter(({ clientPointId }) => completedClientPointIds.has(clientPointId))
    .map(({ id }) => id);
  const incompleteIds = ids.filter((id) => !completedIds.includes(id));

  if (completedIds.length > 0) {
    await trackingModule.deleteCiphertexts(completedIds);
  }
  if (incompleteIds.length > 0) {
    await trackingModule.requeueCiphertexts(incompleteIds, "UPLOAD_RESPONSE_INCOMPLETE");
  }
};

const flushGroup = async (
  trackingModule: Awaited<ReturnType<typeof loadTrackingModule>>,
  items: CiphertextQueueItem[],
) => {
  if (!trackingModule || items.length === 0) {
    return;
  }

  const invalidItems = items.filter((item) => !isUploadableQueueItem(item));
  const validItems = items.filter(isUploadableQueueItem);

  if (invalidItems.length > 0) {
    await trackingModule.deleteCiphertexts(invalidItems.map(({ id }) => id));
  }
  if (validItems.length === 0) {
    return;
  }

  const validIds = validItems.map(({ id }) => id);
  const markResult = await tryCatch(trackingModule.markCiphertextsInFlight(validIds));
  if (markResult.error) {
    return;
  }

  const itemsBySender = new Map<string, UploadableQueueItem[]>();
  for (const item of validItems) {
    itemsBySender.set(item.senderDeviceId, [
      ...(itemsBySender.get(item.senderDeviceId) ?? []),
      item,
    ]);
  }

  await Promise.all(
    Array.from(itemsBySender.values()).map((senderItems) =>
      uploadClaimedItems(trackingModule, senderItems),
    ),
  );
};

const flushPendingTrackingPointsInternal = async (): Promise<void> => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) {
    return;
  }

  const pendingItems = (await trackingModule.listPendingCiphertexts(100)).filter((item) =>
    isReadyForRetry(item, Date.now()),
  );
  const itemsByGroup = new Map<string, CiphertextQueueItem[]>();

  for (const item of pendingItems) {
    itemsByGroup.set(item.groupId, [...(itemsByGroup.get(item.groupId) ?? []), item]);
  }

  await Promise.all(
    Array.from(itemsByGroup.values()).map((items) => flushGroup(trackingModule, items)),
  );
};

export const flushPendingTrackingPoints = (): Promise<void> => {
  if (flushPromise) {
    return flushPromise;
  }

  flushPromise = flushPendingTrackingPointsInternal().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
};

const revokeTrackingAccessInternal = async (): Promise<void> => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) {
    return;
  }

  trackingModule.revokeEpochKeys();
  await trackingModule.stopCapture();
};

export const revokeTrackingAccess = (): Promise<void> => {
  if (revokePromise) {
    return revokePromise;
  }

  revokePromise = revokeTrackingAccessInternal().finally(() => {
    revokePromise = null;
  });
  return revokePromise;
};
