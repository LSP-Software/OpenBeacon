import {
  encodeBase64,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { Platform } from "react-native";
import type { CiphertextQueueItem } from "../modules/openbeacon-tracking/index.ts";
import { trpcClient } from "./api.ts";
import { baseUrl } from "./base-url.ts";
import { getCurrentHistoryKeyState } from "./currentHistoryKey.ts";
import { cancelDeviceKeyRegistrations, ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { isDeviceOffline } from "./networkStatus.ts";
import { backfillHistoryWraps } from "./recovery.ts";
import { recordTrackingUpload } from "./trackingUploadTime.ts";
import { notifyGroupEpochChange } from "./trackingEvents.ts";

let reconcilePromise: Promise<void> | null = null;
const cancelReconciliations = new Set<() => void>();
let reconcileOptions: { startCapture: boolean; onlyIfRunning: boolean } | null = null;
let reconcileVersion = 0;
let flushPromise: Promise<void> | null = null;
let flushWork: Promise<void> | null = null;
let flushController: AbortController | null = null;
let revokePromise: Promise<void> | null = null;
let captureRefreshPending = false;
let trackingPaused = false;
const observedGroupEpochs = new Map<string, string>();

const getQueueOwner = async (signal?: AbortSignal) => {
  const { userId } = await trpcClient.auth.deviceKeyContext.query(
    undefined,
    signal ? { signal } : undefined,
  );
  return JSON.stringify([baseUrl, userId]);
};

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

const canBackfillHistory = async (userId: string) => {
  const current = await tryCatch(getCurrentHistoryKeyState(userId));
  if (getErrorCode(current.error) === "UNAUTHORIZED") throw current.error;
  return current.data?.status === "held";
};

const reconcileTrackingKeysInternal = async ({
  startCapture,
  onlyIfRunning = false,
  isCurrent,
}: {
  startCapture: boolean;
  onlyIfRunning?: boolean;
  isCurrent: () => boolean;
}): Promise<void> => {
  const trackingModule = await loadTrackingModule();
  if (!isCurrent() || (onlyIfRunning && (!trackingModule || !trackingModule.isCaptureRunning()))) {
    return;
  }

  if (!trackingModule || !startCapture) {
    if (trackingModule) {
      if (trackingModule.isCaptureRunning()) await trackingModule.stopCapture();
      if (!isCurrent()) return;
      trackingModule.revokeEpochKeys();
    }
    const groups = await trpcClient.groupMembership.list.query();
    if (!isCurrent()) return;
    const device = await tryCatch(ensureDeviceKeyRegistration());
    if (getErrorCode(device.error) === "UNAUTHORIZED") throw device.error;
    const canBackfill = device.data ? await canBackfillHistory(device.data.userId) : false;
    if (!isCurrent()) return;
    const results = await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const rotation = await tryCatch(rotateGroupEpochIfRequired(groupId));
        if (!device.data || !canBackfill || !isCurrent()) return [rotation];
        return [rotation, await tryCatch(backfillHistoryWraps({ device: device.data, groupId }))];
      }),
    );
    const unauthorized = results.flat().find(({ error }) => getErrorCode(error) === "UNAUTHORIZED");
    if (unauthorized?.error) throw unauthorized.error;
    return;
  }

  const deviceKeyContext = await ensureDeviceKeyRegistration();
  if (!isCurrent()) return;
  const owner = await getQueueOwner();
  if (!isCurrent() || owner !== JSON.stringify([baseUrl, deviceKeyContext.userId])) return;
  trackingModule.setQueueOwner(owner);
  const groups = await trpcClient.groupMembership.list.query();
  if (!isCurrent()) return;
  const preserveGroupIds = new Set<string>();
  const epochs = (
    await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const rotation = await tryCatch(rotateGroupEpochIfRequired(groupId));
        if (!isCurrent()) return null;
        if (getErrorCode(rotation.error) === "UNAUTHORIZED") throw rotation.error;
        const latest = await tryCatch(trpcClient.groupEpoch.getLatest.query({ groupId }));
        if (latest.error) {
          if (getErrorCode(latest.error) === "UNAUTHORIZED") throw latest.error;
          preserveGroupIds.add(groupId);
          return null;
        }
        if (!latest.data) {
          preserveGroupIds.add(groupId);
          return null;
        }
        return { epochId: latest.data.epochId, groupId };
      }),
    )
  ).filter((epoch) => epoch !== null);
  if (!isCurrent()) return;
  if (isCurrent()) {
    for (const { groupId, epochId } of epochs) {
      const previousEpochId = observedGroupEpochs.get(groupId);
      observedGroupEpochs.set(groupId, epochId);
      if (previousEpochId && previousEpochId !== epochId) notifyGroupEpochChange(groupId);
    }
  }
  const resolvedEpochs = (
    await Promise.all(
      epochs.map(async ({ epochId, groupId }) => {
        const result = await tryCatch(
          resolveEpochKey({ device: deviceKeyContext, epochId, groupId }),
        );
        if (result.error) {
          if (getErrorCode(result.error) === "UNAUTHORIZED") throw result.error;
          preserveGroupIds.add(groupId);
          return null;
        }
        if (!result.data) {
          preserveGroupIds.add(groupId);
          return null;
        }

        return { epochId, epochKey: result.data, groupId };
      }),
    )
  ).filter((epoch) => epoch !== null);
  const resolvedKeyMetadata = resolvedEpochs.map(({ epochId, groupId }) => ({
    epochId,
    groupId,
    kind: TRACKING_POINT_KIND,
    senderDeviceId: deviceKeyContext.deviceId,
  }));

  if (!isCurrent() || (onlyIfRunning && !trackingModule.isCaptureRunning())) return;

  const currentKeys = [...trackingModule.listProvisionedEpochKeys()];
  const preservedKeys = currentKeys.filter(({ groupId }) => preserveGroupIds.has(groupId));
  const desiredKeyMetadata = [...resolvedKeyMetadata, ...preservedKeys];
  if (!haveMatchingProvisionedKeys({ current: currentKeys, desired: desiredKeyMetadata })) {
    const keys = resolvedEpochs.map(({ epochId, epochKey, groupId }) => ({
      epochId,
      epochKeyBase64: encodeBase64(epochKey.expose()),
      groupId,
      kind: TRACKING_POINT_KIND,
      senderDeviceId: deviceKeyContext.deviceId,
    }));
    if (!isCurrent() || (onlyIfRunning && !trackingModule.isCaptureRunning())) return;
    trackingModule.provisionEpochKeys(keys, [...preserveGroupIds]);
    if (
      currentKeys.length > 0 &&
      desiredKeyMetadata.some(
        (desired) =>
          !currentKeys.some(
            (current) => getProvisionedKeyIdentity(current) === getProvisionedKeyIdentity(desired),
          ),
      )
    ) {
      captureRefreshPending = true;
    }
  }

  if (startCapture && desiredKeyMetadata.length > 0) {
    if (!isCurrent() || (onlyIfRunning && !trackingModule.isCaptureRunning())) return;
    if (!trackingModule.isCaptureRunning()) {
      await trackingModule.startCapture();
      captureRefreshPending = false;
    } else if (captureRefreshPending) {
      await trackingModule.refreshCapture();
      captureRefreshPending = false;
    }
  } else if (trackingModule.isCaptureRunning()) {
    await trackingModule.stopCapture();
  }

  if (!isCurrent()) return;
  if (!(await canBackfillHistory(deviceKeyContext.userId)) || !isCurrent()) return;
  const backfills = await Promise.all(
    groups.map(({ id: groupId }) =>
      tryCatch(backfillHistoryWraps({ device: deviceKeyContext, groupId })),
    ),
  );
  const unauthorized = backfills.find(({ error }) => getErrorCode(error) === "UNAUTHORIZED");
  if (unauthorized?.error) throw unauthorized.error;
};

export const reconcileTrackingKeys = ({
  startCapture,
  onlyIfRunning = false,
}: {
  startCapture: boolean;
  onlyIfRunning?: boolean;
}): Promise<void> => {
  if (trackingPaused) return Promise.resolve();
  if (
    reconcilePromise &&
    (onlyIfRunning ||
      (reconcileOptions?.startCapture === startCapture && !reconcileOptions.onlyIfRunning))
  ) {
    return reconcilePromise;
  }

  const previous = reconcilePromise;
  const version = ++reconcileVersion;
  reconcileOptions = { startCapture, onlyIfRunning };
  const stopImmediately = !startCapture
    ? (async () => {
        const trackingModule = await loadTrackingModule();
        if (trackingModule) await trackingModule.stopCapture();
      })()
    : Promise.resolve();
  const task = (async () => {
    await stopImmediately;
    if (previous) await tryCatch(previous);
    if (version !== reconcileVersion) return;
    const result = await tryCatch(
      reconcileTrackingKeysInternal({
        startCapture,
        onlyIfRunning,
        isCurrent: () => version === reconcileVersion,
      }),
    );
    if (result.error) {
      if (version === reconcileVersion && getErrorCode(result.error) === "UNAUTHORIZED")
        await revokeTrackingAccess();
      throw result.error;
    }
  })();
  let cancel = () => {};
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve;
  });
  cancelReconciliations.add(cancel);
  const wrapped = Promise.race([task, cancelled]).finally(() => {
    cancelReconciliations.delete(cancel);
    if (reconcilePromise === wrapped) {
      reconcilePromise = null;
      reconcileOptions = null;
    }
  });
  reconcilePromise = wrapped;
  return wrapped;
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

type UploadableQueueItem = CiphertextQueueItem & {
  algorithm: typeof PAYLOAD_ENCRYPTION_ALGORITHM;
  kind: typeof TRACKING_POINT_KIND;
};

const isUploadableQueueItem = (item: CiphertextQueueItem): item is UploadableQueueItem =>
  item.algorithm === PAYLOAD_ENCRYPTION_ALGORITHM && item.kind === TRACKING_POINT_KIND;

const uploadClaimedItems = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  items: UploadableQueueItem[],
  signal: AbortSignal,
): Promise<void> => {
  const ids = items.map(({ id }) => id);
  if (signal.aborted) {
    await trackingModule.requeueCiphertexts(ids, "UPLOAD_CANCELLED");
    throw new Error("Tracking upload cancelled");
  }
  const sentAt = new Date().toISOString();
  const uploadResult = await tryCatch(
    trpcClient.groupTracking.uploadBatch.mutate(
      {
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
      },
      { signal },
    ),
  );

  if (signal.aborted) {
    await trackingModule.requeueCiphertexts(ids, "UPLOAD_CANCELLED");
    throw new Error("Tracking upload cancelled");
  }
  if (uploadResult.error) {
    if (getErrorCode(uploadResult.error) === "UNAUTHORIZED") {
      await revokeTrackingAccess({ cancelFlush: false });
      await trackingModule.requeueCiphertexts(ids, getQueueError(uploadResult.error));
      throw uploadResult.error;
    }
    if (getErrorCode(uploadResult.error) === "BAD_REQUEST" && items.length > 1) {
      const midpoint = Math.ceil(items.length / 2);
      const results = await Promise.allSettled([
        uploadClaimedItems(trackingModule, items.slice(0, midpoint), signal),
        uploadClaimedItems(trackingModule, items.slice(midpoint), signal),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("Tracking upload failed");
      }
      return;
    }
    await trackingModule.requeueCiphertexts(ids, getQueueError(uploadResult.error));
    throw new Error("Tracking upload failed");
  }

  if (uploadResult.data.accepted.length > 0 && items[0]) {
    const { senderDeviceId, groupId } = items[0];
    await tryCatch(
      Promise.resolve().then(() => recordTrackingUpload(senderDeviceId, groupId, sentAt)),
    );
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
    throw new Error("Tracking upload response was incomplete");
  }
};

const flushGroup = async (
  trackingModule: Awaited<ReturnType<typeof loadTrackingModule>>,
  items: CiphertextQueueItem[],
  signal: AbortSignal,
) => {
  if (!trackingModule || items.length === 0) {
    return;
  }

  const invalidItems = items.filter((item) => !isUploadableQueueItem(item));
  const validItems = items.filter(isUploadableQueueItem);

  if (validItems.length === 0) {
    if (invalidItems.length > 0) throw new Error("Unsupported tracking queue item");
    return;
  }

  const validIds = validItems.map(({ id }) => id);
  const markResult = await tryCatch(trackingModule.markCiphertextsInFlight(validIds));
  if (markResult.error) {
    throw markResult.error;
  }
  const claimedIds = new Set(markResult.data);

  const itemsBySender = new Map<string, UploadableQueueItem[]>();
  for (const item of validItems.filter(({ id }) => claimedIds.has(id))) {
    itemsBySender.set(item.senderDeviceId, [
      ...(itemsBySender.get(item.senderDeviceId) ?? []),
      item,
    ]);
  }

  const results = await Promise.allSettled(
    Array.from(itemsBySender.values()).map((senderItems) =>
      uploadClaimedItems(trackingModule, senderItems, signal),
    ),
  );
  if (invalidItems.length > 0 || results.some((result) => result.status === "rejected")) {
    throw new Error("Tracking upload failed");
  }
};

const flushPendingTrackingPointsInternal = async (
  force: boolean,
  signal: AbortSignal,
): Promise<void> => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) {
    return;
  }

  if (signal.aborted) return;
  const owner = await getQueueOwner(signal);
  let afterId = 0;
  let failed = false;
  while (true) {
    if (signal.aborted) return;
    const pending = await trackingModule.listPendingCiphertexts(owner, 100, afterId);
    if (signal.aborted) return;
    const pendingItems = pending.filter((item) => force || isReadyForRetry(item, Date.now()));
    const itemsByGroup = new Map<string, CiphertextQueueItem[]>();
    for (const item of pendingItems) {
      itemsByGroup.set(item.groupId, [...(itemsByGroup.get(item.groupId) ?? []), item]);
    }
    const results = await Promise.allSettled(
      Array.from(itemsByGroup.values()).map((items) => flushGroup(trackingModule, items, signal)),
    );
    failed ||= results.some((result) => result.status === "rejected");
    if (pending.length < 100) break;
    afterId = pending[pending.length - 1]?.id ?? afterId;
  }
  if (failed) throw new Error("Tracking upload failed");
};

export const flushPendingTrackingPoints = (force = false): Promise<void> => {
  if (trackingPaused) return Promise.resolve();
  if (flushPromise) {
    return force
      ? flushPromise.catch(() => {}).then(() => flushPendingTrackingPoints(true))
      : flushPromise;
  }

  const controller = new AbortController();
  flushController = controller;
  const work = flushPendingTrackingPointsInternal(force, controller.signal);
  flushWork = work;
  const current = Promise.race([
    work,
    new Promise<void>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(), { once: true }),
    ),
  ]).finally(() => {
    if (flushPromise === current) {
      flushPromise = null;
      flushWork = null;
      flushController = null;
    }
  });
  flushPromise = current;
  return current;
};

export const syncBackgroundTracking = async () => {
  const reconciliation = await tryCatch(
    reconcileTrackingKeys({ startCapture: true, onlyIfRunning: true }),
  );
  if (getErrorCode(reconciliation.error) === "UNAUTHORIZED") return;
  const result = await tryCatch(flushPendingTrackingPoints());
  if (result.error && !(await isDeviceOffline())) {
    throw result.error;
  }
};

const revokeTrackingAccessInternal = async (): Promise<void> => {
  reconcileVersion += 1;
  reconcileOptions = null;
  for (const cancel of cancelReconciliations) cancel();
  cancelReconciliations.clear();
  reconcilePromise = null;
  captureRefreshPending = false;
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) {
    return;
  }

  try {
    trackingModule.revokeEpochKeys();
  } finally {
    await trackingModule.stopCapture();
  }
};

export const revokeTrackingAccess = ({
  cancelFlush = true,
}: { cancelFlush?: boolean } = {}): Promise<void> => {
  cancelDeviceKeyRegistrations();
  if (cancelFlush) {
    flushController?.abort();
    flushPromise = null;
    flushWork = null;
    flushController = null;
  }
  if (revokePromise) {
    return revokePromise;
  }

  revokePromise = revokeTrackingAccessInternal().finally(() => {
    revokePromise = null;
  });
  return revokePromise;
};

export const prepareTrackingSignOut = async (): Promise<void> => {
  trackingPaused = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const previousFlush = flushWork ? tryCatch(flushWork) : null;
  flushController?.abort();
  flushPromise = null;
  flushWork = null;
  flushController = null;
  try {
    await Promise.race([
      (async () => {
        await revokeTrackingAccess();
        if (previousFlush) await previousFlush;
        if (!controller.signal.aborted) {
          await flushPendingTrackingPointsInternal(true, controller.signal);
        }
      })(),
      new Promise<void>((resolve) =>
        controller.signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

export const resumeTracking = () => {
  trackingPaused = false;
};

export const getUnassignedTrackingPoints = async () => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return null;
  const { userId, recipients } = await trpcClient.auth.deviceKeyContext.query();
  const counts = await Promise.all(
    recipients.map(async ({ deviceId }) => ({
      deviceId,
      count: await trackingModule.countUnassignedCiphertexts(deviceId),
    })),
  );
  const deviceIds = counts.filter(({ count }) => count > 0).map(({ deviceId }) => deviceId);
  const count = counts.reduce((total, item) => total + item.count, 0);
  return count > 0 ? { count, deviceIds, server: baseUrl, userId } : null;
};

export const recoverUnassignedTrackingPoints = async ({
  deviceIds,
  userId,
}: {
  deviceIds: string[];
  userId: string;
}) => {
  if (trackingPaused) throw new Error("Tracking is paused.");
  const trackingModule = await loadTrackingModule();
  const context = await trpcClient.auth.deviceKeyContext.query();
  if (
    !trackingModule ||
    trackingPaused ||
    context.userId !== userId ||
    !deviceIds.every((deviceId) =>
      context.recipients.some((recipient) => recipient.deviceId === deviceId),
    )
  ) {
    throw new Error("The tracking account has changed.");
  }
  for (const deviceId of deviceIds) {
    await trackingModule.assignUnassignedCiphertexts(deviceId, JSON.stringify([baseUrl, userId]));
  }
  await flushPendingTrackingPoints(true);
};

export const getTrackingQueueEviction = async (userId: string) => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return null;
  const owner = JSON.stringify([baseUrl, userId]);
  const eviction = await trackingModule.getCiphertextEviction(owner);
  return eviction ? { ...eviction, owner } : null;
};

export const dismissTrackingQueueEviction = async ({
  owner,
  revision,
}: {
  owner: string;
  revision: number;
}) => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return;
  await trackingModule.acknowledgeCiphertextEviction(owner, revision);
};
