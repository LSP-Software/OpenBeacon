import {
  encodeBase64,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { Platform } from "react-native";
import type { CiphertextQueueItem } from "../modules/openbeacon-tracking/index.ts";
import { trpcClient } from "./api.ts";
import {
  apiCompatibilityNotice,
  getApiCompatibility,
  markApiCompatibilityNotified,
  refreshApiCompatibilityInBackground,
} from "./apiCompatibility.ts";
import { baseUrl } from "./base-url.ts";
import { createHistoryKey } from "./createHistoryKey.ts";
import { getCurrentHistoryKeyState } from "./currentHistoryKey.ts";
import { getStoredHistoryKey } from "./historyKeys.ts";
import {
  cancelDeviceKeyRegistrations,
  ensureDeviceKeyRegistration,
  forgetDeviceKeyRegistration,
  getRegisteredDeviceKey,
} from "./deviceKeys.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { isDeviceOffline } from "./networkStatus.ts";
import { backfillHistoryWraps } from "./recovery.ts";
import { resealPersonalData } from "./resealPersonalData.ts";
import { hasCustomServerUrl } from "./server-url.ts";
import {
  clearTrackingKeyCheck,
  getMembershipSignature,
  hasMembershipChanged,
  isTrackingKeyCheckDue,
  markTrackingKeysStale,
  recordTrackingKeyCheck,
} from "./trackingKeyCheck.ts";
import { recordTrackingUpload } from "./trackingUploadTime.ts";
import { notifyGroupEpochChange } from "./trackingEvents.ts";

let reconcilePromise: Promise<boolean> | null = null;
const cancelReconciliations = new Set<() => void>();
let reconcileOptions: { startCapture: boolean; onlyIfRunning: boolean; force: boolean } | null =
  null;
let reconcileVersion = 0;
let flushPromise: Promise<void> | null = null;
let flushWork: Promise<void> | null = null;
let flushController: AbortController | null = null;
let revokePromise: Promise<void> | null = null;
let captureRefreshPending = false;
let trackingPaused = false;
let uploadRejectedKeys = false;
let keyAccessChangePending = false;
const observedGroupEpochs = new Map<string, string>();
const lastCleanBackfills = new Map<string, { at: number; missingVersion: number | null }>();

const getOwner = (userId: string) => JSON.stringify([baseUrl, userId]);

const getQueueOwner = async (signal?: AbortSignal) => {
  const device = await getRegisteredDeviceKey();
  if (device) return getOwner(device.userId);
  const { userId } = await trpcClient.auth.deviceKeyContext.query(
    undefined,
    signal ? { signal } : undefined,
  );
  return getOwner(userId);
};

const getKeyCheckScope = (userId: string, startCapture: boolean) =>
  JSON.stringify([baseUrl, userId, startCapture]);

const hasFreshKeyCheck = async (startCapture: boolean) => {
  const device = await getRegisteredDeviceKey();
  return Boolean(device && !isTrackingKeyCheckDue(getKeyCheckScope(device.userId, startCapture)));
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

const checkHistoryBackfill = async (userId: string) => {
  const lastCleanBackfill = lastCleanBackfills.get(userId);
  if (
    lastCleanBackfill !== undefined &&
    Date.now() - lastCleanBackfill.at < 10 * 60 * 1000 &&
    (lastCleanBackfill.missingVersion === null ||
      !(await getStoredHistoryKey({ userId, version: lastCleanBackfill.missingVersion })))
  ) {
    return null;
  }
  const current = await tryCatch(getCurrentHistoryKeyState(userId));
  if (getErrorCode(current.error) === "UNAUTHORIZED") throw current.error;
  if (current.data?.status === "none") {
    const created = await tryCatch(createHistoryKey(userId));
    if (getErrorCode(created.error) === "UNAUTHORIZED") throw created.error;
    return {
      canBackfill: created.data === true,
      completed: !created.error,
      createdKey: created.data === true,
      missingVersion: created.data === false ? 1 : null,
    };
  }
  return {
    canBackfill: current.data?.status === "held",
    completed: !current.error,
    createdKey: false,
    missingVersion:
      current.data?.status === "missing" || current.data?.status === "onOtherDevice"
        ? current.data.version
        : null,
  };
};

const recordCleanBackfill = ({
  backfills,
  check,
  userId,
}: {
  backfills: { error: unknown }[];
  check: { completed: boolean; missingVersion: number | null } | null;
  userId: string;
}) => {
  if (check?.completed && backfills.every(({ error }) => !error)) {
    lastCleanBackfills.set(userId, { at: Date.now(), missingVersion: check.missingVersion });
  }
};

const applyCaptureState = async ({
  hasKeys,
  isCurrent,
  onlyIfRunning,
  trackingModule,
}: {
  hasKeys: boolean;
  isCurrent: () => boolean;
  onlyIfRunning: boolean;
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>;
}) => {
  if (!hasKeys) {
    if (trackingModule.isCaptureRunning()) await trackingModule.stopCapture();
    return;
  }
  if (!isCurrent() || (onlyIfRunning && !trackingModule.isCaptureRunning())) return;
  if (!trackingModule.isCaptureRunning()) {
    await trackingModule.startCapture();
    captureRefreshPending = false;
  } else if (captureRefreshPending) {
    await trackingModule.refreshCapture();
    captureRefreshPending = false;
  }
};

const reconcileTrackingKeysInternal = async ({
  startCapture,
  onlyIfRunning = false,
  force,
  isCurrent,
}: {
  startCapture: boolean;
  onlyIfRunning?: boolean;
  force: boolean;
  isCurrent: () => boolean;
}): Promise<boolean> => {
  const trackingModule = await loadTrackingModule();
  if (!isCurrent() || (onlyIfRunning && (!trackingModule || !trackingModule.isCaptureRunning()))) {
    return false;
  }

  if (!trackingModule || !startCapture) {
    if (trackingModule) {
      if (trackingModule.isCaptureRunning()) await trackingModule.stopCapture();
      if (!isCurrent()) return false;
      trackingModule.revokeEpochKeys();
    }
    if (!force && (await hasFreshKeyCheck(false))) return false;
    if (!isCurrent()) return false;
    const [groups, device] = await Promise.all([
      trpcClient.groupMembership.list.query(),
      tryCatch(ensureDeviceKeyRegistration({ checkOwner: force })),
    ]);
    if (!isCurrent()) return false;
    if (getErrorCode(device.error) === "UNAUTHORIZED") throw device.error;
    const backfillCheck = device.data ? await checkHistoryBackfill(device.data.userId) : null;
    if (!isCurrent()) return false;
    const results = await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const rotation = await tryCatch(rotateGroupEpochIfRequired(groupId));
        if (!device.data || !backfillCheck?.canBackfill || !isCurrent()) return [rotation];
        return [rotation, await tryCatch(backfillHistoryWraps({ device: device.data, groupId }))];
      }),
    );
    const unauthorized = results.flat().find(({ error }) => getErrorCode(error) === "UNAUTHORIZED");
    if (unauthorized?.error) throw unauthorized.error;
    if (device.data && backfillCheck?.createdKey && isCurrent()) {
      await resealPersonalData(device.data.userId);
    }
    const membership = getMembershipSignature(groups);
    const changed =
      hasMembershipChanged(membership) ||
      results.some(([rotation, backfill]) => rotation?.data === true || Boolean(backfill?.data));
    if (device.data && isCurrent()) {
      const backfills = results.flatMap((result) => result.slice(1));
      recordCleanBackfill({ backfills, check: backfillCheck, userId: device.data.userId });
      if (backfillCheck?.completed !== false && results.flat().every(({ error }) => !error)) {
        recordTrackingKeyCheck({
          membership,
          scope: getKeyCheckScope(device.data.userId, false),
        });
      }
    }
    return changed;
  }

  if (!force && (await hasFreshKeyCheck(true))) {
    if (!isCurrent()) return false;
    await applyCaptureState({
      hasKeys: trackingModule.listProvisionedEpochKeys().length > 0,
      isCurrent,
      onlyIfRunning,
      trackingModule,
    });
    return false;
  }
  if (!isCurrent()) return false;

  const [deviceKeyContext, groups] = await Promise.all([
    ensureDeviceKeyRegistration({ checkOwner: force }),
    trpcClient.groupMembership.list.query(),
  ]);
  if (!isCurrent()) return false;
  const owner = getOwner(deviceKeyContext.userId);
  trackingModule.setQueueOwner(owner);
  const preserveGroupIds = new Set<string>();
  let rotated = false;
  let rotationFailed = false;
  const epochs = (
    await Promise.all(
      groups.map(async ({ id: groupId }) => {
        const [rotation, firstLatest] = await Promise.all([
          tryCatch(rotateGroupEpochIfRequired(groupId)),
          tryCatch(trpcClient.groupEpoch.getLatest.query({ groupId })),
        ]);
        if (!isCurrent()) return null;
        if (getErrorCode(rotation.error) === "UNAUTHORIZED") throw rotation.error;
        rotationFailed ||= Boolean(rotation.error);
        rotated ||= rotation.data === true;
        const latest = rotation.data
          ? await tryCatch(trpcClient.groupEpoch.getLatest.query({ groupId }))
          : firstLatest;
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
  if (!isCurrent()) return false;
  for (const { groupId, epochId } of epochs) {
    const previousEpochId = observedGroupEpochs.get(groupId);
    observedGroupEpochs.set(groupId, epochId);
    if (previousEpochId && previousEpochId !== epochId) notifyGroupEpochChange(groupId);
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

  if (!isCurrent() || (onlyIfRunning && !trackingModule.isCaptureRunning())) return false;

  const currentKeys = [...trackingModule.listProvisionedEpochKeys()];
  const preservedKeys = currentKeys.filter(({ groupId }) => preserveGroupIds.has(groupId));
  const desiredKeyMetadata = [...resolvedKeyMetadata, ...preservedKeys];
  const keysChanged = !haveMatchingProvisionedKeys({
    current: currentKeys,
    desired: desiredKeyMetadata,
  });
  if (keysChanged) {
    const keys = resolvedEpochs.map(({ epochId, epochKey, groupId }) => ({
      epochId,
      epochKeyBase64: encodeBase64(epochKey.expose()),
      groupId,
      kind: TRACKING_POINT_KIND,
      senderDeviceId: deviceKeyContext.deviceId,
    }));
    if (!isCurrent() || (onlyIfRunning && !trackingModule.isCaptureRunning())) return false;
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

  await applyCaptureState({
    hasKeys: desiredKeyMetadata.length > 0,
    isCurrent,
    onlyIfRunning,
    trackingModule,
  });

  if (!isCurrent()) return false;
  const membership = getMembershipSignature(groups);
  const changed = keysChanged || rotated || hasMembershipChanged(membership);
  const backfillCheck = await checkHistoryBackfill(deviceKeyContext.userId);
  if (!isCurrent()) return false;
  const backfills = backfillCheck?.canBackfill
    ? await Promise.all(
        groups.map(({ id: groupId }) =>
          tryCatch(backfillHistoryWraps({ device: deviceKeyContext, groupId })),
        ),
      )
    : [];
  const unauthorized = backfills.find(({ error }) => getErrorCode(error) === "UNAUTHORIZED");
  if (unauthorized?.error) throw unauthorized.error;
  if (backfillCheck?.createdKey && isCurrent()) await resealPersonalData(deviceKeyContext.userId);
  if (backfillCheck) {
    recordCleanBackfill({ backfills, check: backfillCheck, userId: deviceKeyContext.userId });
  }
  if (
    isCurrent() &&
    preserveGroupIds.size === 0 &&
    !rotationFailed &&
    backfillCheck?.completed !== false &&
    backfills.every(({ error }) => !error)
  ) {
    recordTrackingKeyCheck({
      membership,
      scope: getKeyCheckScope(deviceKeyContext.userId, true),
    });
  }
  return changed || backfills.some(({ data }) => Boolean(data));
};

export const takeKeyAccessChange = () => {
  const changed = keyAccessChangePending;
  keyAccessChangePending = false;
  return changed;
};

export const reconcileTrackingKeys = ({
  startCapture,
  onlyIfRunning = false,
  force = false,
}: {
  startCapture: boolean;
  onlyIfRunning?: boolean;
  force?: boolean;
}): Promise<boolean> => {
  if (trackingPaused) return Promise.resolve(false);
  if (
    reconcilePromise &&
    (onlyIfRunning ||
      (reconcileOptions?.startCapture === startCapture &&
        !reconcileOptions.onlyIfRunning &&
        (reconcileOptions.force || !force)))
  ) {
    return reconcilePromise;
  }

  const previous = reconcilePromise;
  const version = ++reconcileVersion;
  reconcileOptions = { startCapture, onlyIfRunning, force };
  const stopImmediately = !startCapture
    ? (async () => {
        const trackingModule = await loadTrackingModule();
        if (trackingModule) await trackingModule.stopCapture();
      })()
    : Promise.resolve();
  const task = (async () => {
    await stopImmediately;
    if (previous) await tryCatch(previous);
    if (version !== reconcileVersion) return false;
    const result = await tryCatch(
      reconcileTrackingKeysInternal({
        startCapture,
        onlyIfRunning,
        force,
        isCurrent: () => version === reconcileVersion,
      }),
    );
    if (result.error) {
      if (version === reconcileVersion && getErrorCode(result.error) === "UNAUTHORIZED")
        await revokeTrackingAccess();
      throw result.error;
    }
    if (result.data) keyAccessChangePending = true;
    return result.data;
  })();
  let cancel = () => {};
  const cancelled = new Promise<boolean>((resolve) => {
    cancel = () => resolve(false);
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
    const code = getErrorCode(uploadResult.error);
    if (code === "FORBIDDEN" || code === "BAD_REQUEST") {
      const device = await getRegisteredDeviceKey();
      const usesCurrentDevice = items.some(
        ({ senderDeviceId }) => senderDeviceId === device?.deviceId,
      );
      const provisionedKeys = trackingModule.listProvisionedEpochKeys();
      const usesCurrentKey = items.some((item) =>
        provisionedKeys.some(
          (key) => getProvisionedKeyIdentity(key) === getProvisionedKeyIdentity(item),
        ),
      );
      if (
        code === "FORBIDDEN" &&
        usesCurrentDevice &&
        uploadResult.error.message === "The active device is not registered."
      ) {
        forgetDeviceKeyRegistration();
        markTrackingKeysStale();
        uploadRejectedKeys = true;
      } else if (usesCurrentKey) {
        markTrackingKeysStale();
        uploadRejectedKeys = true;
      }
    }
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
  if (trackingPaused || getApiCompatibility()) return Promise.resolve();
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

const showApiCompatibilityNotice = async () => {
  const compatibility = getApiCompatibility();
  if (!compatibility || compatibility.notified) return;
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return;
  const { title, body } = apiCompatibilityNotice({
    problem: compatibility.problem,
    selfHosted: hasCustomServerUrl(),
  });
  const shown = await tryCatch(
    Promise.resolve().then(() => trackingModule.showCompatibilityNotice(title, body)),
  );
  if (shown.data) markApiCompatibilityNotified();
};

export const clearApiCompatibilityNotice = async () => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return;
  await tryCatch(Promise.resolve().then(() => trackingModule.clearCompatibilityNotice()));
};

export const syncBackgroundTracking = async () => {
  if (getApiCompatibility()) {
    await refreshApiCompatibilityInBackground();
    if (!getApiCompatibility()) await clearApiCompatibilityNotice();
  }
  if (getApiCompatibility()) {
    await showApiCompatibilityNotice();
    return;
  }
  const reconciliation = await tryCatch(
    reconcileTrackingKeys({ startCapture: true, onlyIfRunning: true }),
  );
  if (getErrorCode(reconciliation.error) === "UNAUTHORIZED") return;
  uploadRejectedKeys = false;
  const result = await tryCatch(flushPendingTrackingPoints());
  if (getApiCompatibility()) {
    await showApiCompatibilityNotice();
    return;
  }
  if (uploadRejectedKeys) {
    await tryCatch(reconcileTrackingKeys({ startCapture: true, onlyIfRunning: true }));
  }
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
  clearTrackingKeyCheck();
  keyAccessChangePending = false;
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

export const deleteQueuedTrackingPoints = async ({
  deviceId,
  userId,
}: {
  deviceId: string;
  userId: string;
}) => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return;
  const owner = getOwner(userId);
  await trackingModule.assignUnassignedCiphertexts(deviceId, owner);
  for (;;) {
    const items = await trackingModule.listPendingCiphertexts(owner, 500);
    if (!items.length) return;
    await trackingModule.deleteCiphertexts(items.map(({ id }) => id));
  }
};

export const resumeTracking = () => {
  trackingPaused = false;
  lastCleanBackfills.clear();
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
    await trackingModule.assignUnassignedCiphertexts(deviceId, getOwner(userId));
  }
  await flushPendingTrackingPoints(true);
};

export const getTrackingQueueEviction = async (userId: string) => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return null;
  const owner = getOwner(userId);
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
