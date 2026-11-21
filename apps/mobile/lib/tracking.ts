import {
  encodeBase64,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import { groupTrackingPointSchema, placeTransitionSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import type {
  CiphertextQueueItem,
  QueuedPlaceTransition,
} from "../modules/openbeacon-tracking/index.ts";
import { trpcClient } from "./api.ts";
import {
  getApiCompatibility,
  markApiCompatibilityNotified,
  refreshApiCompatibilityInBackground,
} from "./apiCompatibility.ts";
import { getBaseUrl, hasCustomServerUrl } from "./currentServer.ts";
import { createHistoryKey } from "./createHistoryKey.ts";
import { getCurrentHistoryKeyState } from "./currentHistoryKey.ts";
import { isThisDeviceActive } from "./deviceActivation.ts";
import { getStoredHistoryKey } from "./historyKeys.ts";
import { secretOwner } from "./secretStorage.ts";
import { checkSessionAfterUnauthorized } from "./sessionCheck.ts";
import {
  accountRequest,
  type AccountRound,
  isRoundCurrent,
  refuseStartedRounds,
  startAccountRound,
} from "./accountSession.ts";
import { refreshSessionIfDue } from "./sessionRefresh.ts";
import {
  cancelDeviceKeyRegistrations,
  ensureDeviceKeyRegistration,
  getRegisteredDeviceKey,
} from "./deviceKeys.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import { errorReason } from "./errorReason.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { isDeviceOffline } from "./networkStatus.ts";
import {
  getAccountNoticesCursor,
  getNoticesCursor,
  showAccountNotices,
} from "./noticeBackgroundSync.ts";
import { clearEventNotices, dismissNotice, showNotice } from "./notifications.ts";
import {
  applyPlaceUpdates,
  getPlaceAlertsCursor,
  type PlaceUpdates,
  settleImageKeyCatchUps,
} from "./placeBackgroundSync.ts";
import { backfillHistoryWraps } from "./recovery.ts";
import { resealPersonalData } from "./resealPersonalData.ts";
import {
  clearTrackingKeyCheck,
  getMembershipSignature,
  getTrackingKeyCheckGeneration,
  hasMembershipChanged,
  isTrackingKeyCheckDue,
  markTrackingKeysStale,
  noteTrackingKeyState,
  readCursorGroup,
  recordTrackingKeyCheck,
  rememberCursorGroup,
} from "./trackingKeyCheck.ts";
import { loadTrackingModule } from "./trackingModule.ts";
import { recordTrackingUpload } from "./trackingUploadTime.ts";
import { notifyGroupEpochChange } from "./trackingEvents.ts";
import {
  hasLocallyPausedSharing,
  hasPendingSharingChange,
  syncLocationSharing,
  toServerClock,
} from "./locationSharing.ts";

let reconcilePromise: Promise<boolean> | null = null;
const cancelReconciliations = new Set<() => void>();
let reconcileOptions: { startCapture: boolean; onlyIfRunning: boolean; force: boolean } | null =
  null;
let reconcileVersion = 0;
let flushPromise: Promise<void> | null = null;
let flushWork: Promise<void> | null = null;
let flushController: AbortController | null = null;
let placeRoundTail: Promise<void> = Promise.resolve();
let revokePromise: Promise<void> | null = null;
type RevokeNotice = Exclude<Parameters<typeof showNotice>[0]["kind"], "compatibility">;
let revokeNotice: RevokeNotice | null = null;
let captureRefreshPending = false;
let trackingPaused = false;
let uploadRejectedKeys = false;
let keyAccessChangePending = false;
const observedGroupEpochs = new Map<string, string>();
const lastCleanBackfills = new Map<string, { at: number; missingVersion: number | null }>();

const getOwner = (userId: string) => JSON.stringify([getBaseUrl(), userId]);

const getPushScope = (device: { userId: string; deviceId: string }) =>
  JSON.stringify([getBaseUrl(), device.userId, device.deviceId]);

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
  JSON.stringify([getBaseUrl(), userId, startCapture]);

const hasFreshKeyCheck = async (startCapture: boolean) => {
  const device = await getRegisteredDeviceKey();
  return Boolean(device && !isTrackingKeyCheckDue(getKeyCheckScope(device.userId, startCapture)));
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
  const owner = secretOwner(userId);
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
    const created = await tryCatch(createHistoryKey(userId, owner));
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

const isBlockedAsTooOld = () => {
  const problem = getApiCompatibility()?.problem;
  return problem === "appTooOld" || problem === "outOfSync";
};

export const parkCaptureWhileBlocked = async () => {
  if (!isBlockedAsTooOld()) return;
  const trackingModule = await loadTrackingModule();
  if (trackingModule?.isCaptureRunning()) await trackingModule.stopCapture();
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
  if (!hasKeys || isBlockedAsTooOld()) {
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

const syncSharingPreference = async () => {
  const result = await tryCatch(syncLocationSharing());
  if (getErrorCode(result.error) === "UNAUTHORIZED") throw result.error;
};

const isPending = async () => {
  const active = await tryCatch(isThisDeviceActive());
  if (getErrorCode(active.error) === "UNAUTHORIZED") throw active.error;
  return active.data === false;
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
  const generation = getTrackingKeyCheckGeneration();
  const trackingModule = await loadTrackingModule();
  if (!isCurrent() || (onlyIfRunning && !trackingModule?.isCaptureRunning())) {
    return false;
  }

  if (!trackingModule || !startCapture) {
    if (trackingModule) {
      if (trackingModule.isCaptureRunning()) await trackingModule.stopCapture();
      if (!isCurrent()) return false;
      const hadKeys = trackingModule.listProvisionedEpochKeys().length > 0;
      trackingModule.revokeEpochKeys();
      if (hadKeys) markTrackingKeysStale();
    }
    if (!force && (await hasFreshKeyCheck(false))) return false;
    if (!isCurrent()) return false;
    const [groups, device] = await Promise.all([
      trpcClient.groupMembership.list.query(),
      tryCatch(ensureDeviceKeyRegistration({ checkOwner: force })),
    ]);
    if (!isCurrent()) return false;
    if (getErrorCode(device.error) === "UNAUTHORIZED") throw device.error;
    if (device.data) rememberCursorGroup(getOwner(device.data.userId), groups);
    if (device.data && (await isPending())) return false;
    if (!isCurrent()) return false;
    if (device.data) {
      await syncSharingPreference();
      if (!isCurrent()) return false;
    }
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
          generation,
          membership,
          scope: getKeyCheckScope(device.data.userId, false),
        });
      }
    }
    return changed;
  }

  if (!force && (await hasFreshKeyCheck(true))) {
    if (!isCurrent()) return false;
    const registered = await getRegisteredDeviceKey();
    if (
      registered &&
      (hasPendingSharingChange(registered.userId) || hasLocallyPausedSharing(registered.userId))
    ) {
      await syncSharingPreference();
      if (!isCurrent()) return false;
    }
    await applyCaptureState({
      hasKeys: trackingModule.listProvisionedEpochKeys().length > 0,
      isCurrent,
      onlyIfRunning,
      trackingModule,
    });
    return false;
  }
  if (!isCurrent()) return false;

  const cachedDevice = await getRegisteredDeviceKey();
  if (
    cachedDevice &&
    trackingModule.listProvisionedEpochKeys().length > 0 &&
    !hasPendingSharingChange(cachedDevice.userId) &&
    !hasLocallyPausedSharing(cachedDevice.userId) &&
    trackingModule.isQueueOwner(getOwner(cachedDevice.userId), cachedDevice.deviceId)
  ) {
    await applyCaptureState({ hasKeys: true, isCurrent, onlyIfRunning, trackingModule });
    if (!isCurrent()) return false;
  }

  const [deviceKeyContext, groups] = await Promise.all([
    ensureDeviceKeyRegistration({ checkOwner: force }),
    trpcClient.groupMembership.list.query(),
  ]);
  if (!isCurrent()) return false;
  if (await isPending()) {
    if (trackingModule.isCaptureRunning()) await trackingModule.stopCapture();
    return false;
  }
  if (!isCurrent()) return false;
  const owner = getOwner(deviceKeyContext.userId);
  rememberCursorGroup(owner, groups);
  trackingModule.setQueueOwner(owner, deviceKeyContext.deviceId);
  await syncSharingPreference();
  if (!isCurrent()) return false;
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
  const currentKeys = [...trackingModule.listProvisionedEpochKeys()];
  const reusedGroupIds = new Set(
    epochs
      .filter(({ epochId, groupId }) => {
        const groupKeys = currentKeys.filter((key) => key.groupId === groupId);
        return (
          groupKeys.length === 1 &&
          groupKeys[0] !== undefined &&
          getProvisionedKeyIdentity(groupKeys[0]) ===
            getProvisionedKeyIdentity({
              epochId,
              groupId,
              kind: TRACKING_POINT_KIND,
              senderDeviceId: deviceKeyContext.deviceId,
            })
        );
      })
      .map(({ groupId }) => groupId),
  );
  for (const { groupId, epochId } of epochs) {
    const previousEpochId = observedGroupEpochs.get(groupId);
    observedGroupEpochs.set(groupId, epochId);
    if (previousEpochId && previousEpochId !== epochId) notifyGroupEpochChange(groupId);
  }
  const resolvedEpochs = (
    await Promise.all(
      epochs
        .filter(({ groupId }) => !reusedGroupIds.has(groupId))
        .map(async ({ epochId, groupId }) => {
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

  const memberGroupIds = new Set(groups.map(({ id }) => id));
  const leftGroupIds = new Set(
    currentKeys.map(({ groupId }) => groupId).filter((groupId) => !memberGroupIds.has(groupId)),
  );
  for (const groupId of leftGroupIds) {
    await trackingModule.deleteCiphertextsByGroup(owner, groupId);
  }
  if (!isCurrent()) return false;
  const leftPlaceGroupIds = [
    ...new Set([
      ...leftGroupIds,
      ...(trackingModule.listPlaceGroups(owner, deviceKeyContext.deviceId) ?? []),
    ]),
  ].filter((groupId) => !memberGroupIds.has(groupId));
  if (leftPlaceGroupIds.length > 0) trackingModule.revokeEpochKeys(leftPlaceGroupIds);
  const keptGroupIds = new Set([...preserveGroupIds, ...reusedGroupIds]);
  const preservedKeys = currentKeys.filter(({ groupId }) => keptGroupIds.has(groupId));
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
    trackingModule.provisionEpochKeys(keys, [...keptGroupIds]);
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
      generation,
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
        await revokeUnauthorizedTrackingAccess(result.error, { round: null });
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
  item.algorithm === PAYLOAD_ENCRYPTION_ALGORITHM &&
  item.kind === TRACKING_POINT_KIND &&
  groupTrackingPointSchema.safeParse({ ...item, capturedHour: item.capturedHour ?? undefined })
    .success;

const takePlaceAlertsCursor = (round: PlaceRound) => {
  const cursor = round.cursor;
  round.cursor = null;
  return cursor;
};

const startAccountSync = (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  device: { deviceId: string; userId: string },
  account: AccountRound,
  signal?: AbortSignal,
) => {
  const pushScope = getPushScope(device);
  const pushToken = trackingModule.pendingPushToken(pushScope);
  return {
    pushScope,
    pushToken,
    request: tryCatch(
      trpcClient.accountNotices.sync.mutate(
        { cursor: getAccountNoticesCursor(device.userId), ...(pushToken ? { pushToken } : {}) },
        accountRequest(account, signal),
      ),
    ),
    account,
  };
};

const settleAccountSync = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  sync: ReturnType<typeof startAccountSync>,
) => {
  const response = await sync.request;
  if (response.error) {
    if (getErrorCode(response.error) === "UNAUTHORIZED") checkSessionAfterUnauthorized();
    return;
  }
  if (trackingPaused || !isRoundCurrent(sync.account)) return;
  trackingModule.confirmPushToken(sync.pushScope, sync.pushToken, response.data.pushAvailable);
  await tryCatch(showAccountNotices({ notices: response.data, round: sync.account }));
};

const takeAccountSync = (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  round: PlaceRound,
  signal: AbortSignal,
) => {
  if (!round.accountDevice || !round.account || trackingPaused) return;
  round.accountSync = startAccountSync(trackingModule, round.accountDevice, round.account, signal);
  round.accountDevice = null;
};

const placeUploadFields = (
  transitions: readonly QueuedPlaceTransition[],
  cursor: PlaceRound["cursor"],
) => ({
  ...(transitions.length > 0
    ? {
        placeTransitions: transitions.map(
          ({ clientId, direction, occurredAt, placeId, senderDeviceId }) => ({
            clientId,
            direction,
            occurredAt: toServerClock(occurredAt),
            placeId,
            senderDeviceId,
          }),
        ),
      }
    : {}),
  ...(cursor ? { placeAlertsCursor: cursor.placeAlerts, noticesCursor: cursor.notices } : {}),
});

const settlePlaceResponse = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  round: PlaceRound,
  response: {
    placeTransitions?: { accepted: string[]; duplicates: string[]; discarded: string[] };
  } & PlaceUpdates,
) => {
  if (response.placeTransitions) {
    const { accepted, duplicates, discarded } = response.placeTransitions;
    await trackingModule.deletePlaceTransitions([...accepted, ...duplicates, ...discarded]);
  }
  if (
    response.places !== undefined ||
    response.placeAlerts !== undefined ||
    response.imageKeysNeedCatchUp !== undefined ||
    response.notices !== undefined
  ) {
    round.updates = {
      places: response.places,
      placeAlerts: response.placeAlerts,
      imageKeysNeedCatchUp: response.imageKeysNeedCatchUp,
      notices: response.notices,
    };
  }
};

const uploadPlaceTransitionsAlone = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  round: PlaceRound,
  groupId: string,
  transitions: readonly QueuedPlaceTransition[],
  signal: AbortSignal,
) => {
  const cursor = takePlaceAlertsCursor(round);
  takeAccountSync(trackingModule, round, signal);
  const result = await tryCatch(
    trpcClient.groupTracking.uploadBatch.mutate(
      { groupId, points: [], ...placeUploadFields(transitions, cursor) },
      accountRequest(round.account, signal),
    ),
  );
  if (!result.error) {
    await settlePlaceResponse(trackingModule, round, result.data);
    return;
  }
  const code = getErrorCode(result.error);
  const reason = errorReason(result.error);
  if (code === "BAD_REQUEST" || reason === "NOT_GROUP_MEMBER" || reason === "GROUP_GONE") {
    await trackingModule.deletePlaceTransitions(transitions.map(({ clientId }) => clientId));
    return;
  }
  if (code === "UNAUTHORIZED") {
    await revokeUnauthorizedTrackingAccess(result.error, {
      cancelFlush: false,
      round: round.account,
    });
  }
  throw result.error;
};

const uploadClaimedItems = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  owner: string,
  items: UploadableQueueItem[],
  signal: AbortSignal,
  round: PlaceRound,
): Promise<void> => {
  const ids = items.map(({ id }) => id);
  if (signal.aborted) {
    await trackingModule.requeueCiphertexts(ids, "UPLOAD_CANCELLED");
    throw new Error("Tracking upload cancelled");
  }
  const groupId = items[0]?.groupId ?? "";
  const carriesPlaces = items[0]?.senderDeviceId === round.deviceId;
  const transitions = carriesPlaces ? (round.transitions.get(groupId) ?? []) : [];
  if (carriesPlaces) round.transitions.delete(groupId);
  const cursor = carriesPlaces ? takePlaceAlertsCursor(round) : null;
  const sentAt = new Date().toISOString();
  takeAccountSync(trackingModule, round, signal);
  const uploadResult = await tryCatch(
    trpcClient.groupTracking.uploadBatch.mutate(
      {
        groupId,
        ...placeUploadFields(transitions, cursor),
        points: items.map(
          ({ capturedHour, ciphertext, clientPointId, epochId, nonce, role, senderDeviceId }) => ({
            ...(capturedHour === null ? {} : { capturedHour }),
            ciphertext,
            clientPointId,
            epochId,
            nonce,
            role,
            senderDeviceId,
          }),
        ),
      },
      accountRequest(round.account, signal),
    ),
  );

  if (signal.aborted || (uploadResult.error && round.account && !isRoundCurrent(round.account))) {
    await trackingModule.requeueCiphertexts(ids, "UPLOAD_CANCELLED");
    throw new Error("Tracking upload cancelled");
  }
  if (
    uploadResult.error &&
    getErrorCode(uploadResult.error) === "BAD_REQUEST" &&
    (transitions.length > 0 || cursor)
  ) {
    if (transitions.length > 0) round.retryAlone.set(groupId, transitions);
    return uploadClaimedItems(trackingModule, owner, items, signal, round);
  }
  if (uploadResult.error) {
    const code = getErrorCode(uploadResult.error);
    const reason = errorReason(uploadResult.error);
    const device =
      code === "FORBIDDEN" || code === "BAD_REQUEST" ? await getRegisteredDeviceKey() : null;
    const usesCurrentDevice = items.some(
      ({ senderDeviceId }) => senderDeviceId === device?.deviceId,
    );
    if (code === "FORBIDDEN" || code === "BAD_REQUEST") {
      const provisionedKeys = trackingModule.listProvisionedEpochKeys();
      const usesCurrentKey = items.some((item) =>
        provisionedKeys.some(
          (key) => getProvisionedKeyIdentity(key) === getProvisionedKeyIdentity(item),
        ),
      );
      if (usesCurrentKey || (usesCurrentDevice && reason === "DEVICE_NOT_REGISTERED")) {
        markTrackingKeysStale();
        uploadRejectedKeys = true;
      }
    }
    if ((reason === "NOT_GROUP_MEMBER" || reason === "GROUP_GONE") && items[0]) {
      await trackingModule.deleteCiphertextsByGroup(owner, items[0].groupId);
      return;
    }
    if (reason === "DEVICE_NOT_REGISTERED" && device && !usesCurrentDevice) {
      await trackingModule.deleteCiphertexts(ids);
      return;
    }
    if (code === "UNAUTHORIZED") {
      await revokeUnauthorizedTrackingAccess(uploadResult.error, {
        cancelFlush: false,
        round: round.account,
      });
      await trackingModule.requeueCiphertexts(ids, getQueueError(uploadResult.error));
      throw uploadResult.error;
    }
    if (code === "BAD_REQUEST" && items.length > 1) {
      const midpoint = Math.ceil(items.length / 2);
      const results = await Promise.allSettled([
        uploadClaimedItems(trackingModule, owner, items.slice(0, midpoint), signal, round),
        uploadClaimedItems(trackingModule, owner, items.slice(midpoint), signal, round),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("Tracking upload failed");
      }
      return;
    }
    if (code === "BAD_REQUEST") {
      await trackingModule.deleteCiphertexts(ids);
      return;
    }
    await trackingModule.requeueCiphertexts(ids, getQueueError(uploadResult.error));
    throw new Error("Tracking upload failed");
  }

  const {
    accepted,
    duplicates,
    discarded = [],
    expired = [],
    keyState,
  }: {
    accepted: string[];
    discarded?: string[];
    duplicates: string[];
    expired?: string[];
    keyState?: string;
  } = uploadResult.data;

  if (keyState && noteTrackingKeyState(keyState)) uploadRejectedKeys = true;
  await settlePlaceResponse(trackingModule, round, uploadResult.data);

  if (accepted.length > 0 && items[0]) {
    const { senderDeviceId, groupId } = items[0];
    await tryCatch(
      Promise.resolve().then(() => recordTrackingUpload(senderDeviceId, groupId, sentAt)),
    );
  }

  if (expired.length > 0) {
    markTrackingKeysStale();
    uploadRejectedKeys = true;
  }

  const completedClientPointIds = new Set([...accepted, ...duplicates, ...expired, ...discarded]);
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

const getSupersedingKey = (item: CiphertextQueueItem) =>
  item.role === "LIVE"
    ? JSON.stringify([item.role, item.groupId, item.epochId, item.senderDeviceId, item.kind])
    : item.clientPointId;

const flushGroup = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  owner: string,
  validItems: UploadableQueueItem[],
  signal: AbortSignal,
  round: PlaceRound,
) => {
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
      uploadClaimedItems(trackingModule, owner, senderItems, signal, round),
    ),
  );
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Tracking upload failed");
  }
};

type PlaceRound = {
  account: AccountRound | null;
  accountDevice: { deviceId: string; userId: string } | null;
  accountSync: ReturnType<typeof startAccountSync> | null;
  cursor: { placeAlerts: string | null; notices: string | null } | null;
  deviceId: string;
  retryAlone: Map<string, QueuedPlaceTransition[]>;
  transitions: Map<string, QueuedPlaceTransition[]>;
  updates: PlaceUpdates | null;
  userId: string;
};

const startPlaceRound = async (
  trackingModule: NonNullable<Awaited<ReturnType<typeof loadTrackingModule>>>,
  owner: string,
  device: Awaited<ReturnType<typeof getRegisteredDeviceKey>>,
): Promise<PlaceRound> => {
  if (!device || owner !== getOwner(device.userId)) {
    return {
      account: null,
      accountDevice: null,
      accountSync: null,
      cursor: null,
      deviceId: "",
      retryAlone: new Map(),
      transitions: new Map(),
      updates: null,
      userId: "",
    };
  }
  const queued = await tryCatch(trackingModule.listPlaceTransitions(owner));
  const all = queued.data ?? [];
  const sendable = all.filter(
    (transition) =>
      transition.senderDeviceId === device.deviceId &&
      placeTransitionSchema.safeParse({
        ...transition,
        occurredAt: new Date(transition.occurredAt),
      }).success,
  );
  const stale = all.filter((transition) => !sendable.includes(transition));
  if (stale.length > 0) {
    await tryCatch(trackingModule.deletePlaceTransitions(stale.map(({ clientId }) => clientId)));
  }
  const transitions = new Map<string, QueuedPlaceTransition[]>();
  for (const transition of all) {
    if (!sendable.includes(transition)) continue;
    const group = transitions.get(transition.groupId) ?? [];
    if (group.length < 50) transitions.set(transition.groupId, [...group, transition]);
  }
  return {
    account: startAccountRound(device.userId),
    accountDevice: trackingPaused ? null : device,
    accountSync: null,
    cursor: trackingPaused
      ? null
      : {
          placeAlerts: getPlaceAlertsCursor(device.userId),
          notices: getNoticesCursor(device.userId),
        },
    deviceId: device.deviceId,
    retryAlone: new Map(),
    transitions,
    updates: null,
    userId: device.userId,
  };
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
  const device = await getRegisteredDeviceKey();
  if (device && hasPendingSharingChange(device.userId)) return;
  const owner = await getQueueOwner(signal);
  const round = await startPlaceRound(trackingModule, owner, device);
  let afterId = 0;
  let failed = false;
  while (true) {
    if (signal.aborted) return;
    const pending = await trackingModule.listPendingCiphertexts(owner, 100, afterId);
    if (signal.aborted) return;
    const newestIds = new Map<string, number>();
    for (const item of pending) {
      const key = getSupersedingKey(item);
      newestIds.set(key, Math.max(item.id, newestIds.get(key) ?? 0));
    }
    const newest = pending.filter((item) => newestIds.get(getSupersedingKey(item)) === item.id);
    const uploadable = newest.filter(isUploadableQueueItem);
    const uploadableIds = new Set(uploadable.map(({ id }) => id));
    const dropped = pending.filter(({ id }) => !uploadableIds.has(id)).map(({ id }) => id);
    const deleted =
      dropped.length > 0 ? await tryCatch(trackingModule.deleteCiphertexts(dropped)) : null;
    failed ||= Boolean(deleted?.error);
    const pendingItems = deleted?.error
      ? []
      : uploadable.filter((item) => force || isReadyForRetry(item, Date.now()));
    const itemsByGroup = new Map<string, UploadableQueueItem[]>();
    for (const item of pendingItems) {
      itemsByGroup.set(item.groupId, [...(itemsByGroup.get(item.groupId) ?? []), item]);
    }
    const results = await Promise.allSettled(
      Array.from(itemsByGroup.values()).map((items) =>
        flushGroup(trackingModule, owner, items, signal, round),
      ),
    );
    failed ||= results.some((result) => result.status === "rejected");
    if (pending.length < 100) break;
    afterId = pending[pending.length - 1]?.id ?? afterId;
  }
  if (!signal.aborted) {
    const alone = await Promise.allSettled(
      [...round.transitions, ...round.retryAlone].map(([groupId, transitions]) =>
        uploadPlaceTransitionsAlone(trackingModule, round, groupId, transitions, signal),
      ),
    );
    failed ||= alone.some((result) => result.status === "rejected");
    if (round.accountSync && !signal.aborted) {
      await settleAccountSync(trackingModule, round.accountSync);
    }
    if (
      round.updates &&
      round.account &&
      isRoundCurrent(round.account) &&
      !signal.aborted &&
      !trackingPaused
    ) {
      await tryCatch(applyPlaceUpdates({ updates: round.updates, round: round.account }));
    }
  }
  if (failed) throw new Error("Tracking upload failed");
};

const inPlaceRound = <T>(work: () => Promise<T>): Promise<T> => {
  const run = placeRoundTail.then(work);
  placeRoundTail = run.then(
    () => {},
    () => {},
  );
  return run;
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
  const work = placeRoundTail.then(() =>
    flushPendingTrackingPointsInternal(force, controller.signal),
  );
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
  placeRoundTail = current.then(
    () => {},
    () => {},
  );
  return current;
};

export const flushForegroundTrackingPoints = async (force = false) => {
  if (!force && (await loadTrackingModule())?.isCaptureRunning()) return;
  await refreshSessionIfDue();
  await flushPendingTrackingPoints(force);
};

const showApiCompatibilityNotice = async () => {
  const compatibility = getApiCompatibility();
  if (!compatibility || compatibility.notified) return;
  const shown = await showNotice({
    kind: "compatibility",
    problem: compatibility.problem,
    selfHosted: hasCustomServerUrl(),
  });
  if (shown) markApiCompatibilityNotified();
};

const pollPlaceUpdates = ({ onlyWithoutKeys = false }: { onlyWithoutKeys?: boolean } = {}) =>
  inPlaceRound(async () => {
    if (trackingPaused) return;
    const trackingModule = await loadTrackingModule();
    const device = await getRegisteredDeviceKey();
    if (!trackingModule || !device) return;
    const account = startAccountRound(device.userId);
    const keyGroupId = trackingModule.listProvisionedEpochKeys()[0]?.groupId;
    const groupId =
      keyGroupId && onlyWithoutKeys
        ? null
        : (keyGroupId ?? readCursorGroup(getOwner(device.userId)));
    const accountSync = startAccountSync(trackingModule, device, account);
    const upload = groupId
      ? tryCatch(
          trpcClient.groupTracking.uploadBatch.mutate(
            {
              groupId,
              points: [],
              placeAlertsCursor: getPlaceAlertsCursor(device.userId),
              noticesCursor: getNoticesCursor(device.userId),
            },
            accountRequest(account),
          ),
        )
      : null;
    await settleAccountSync(trackingModule, accountSync);
    if (!upload) return;
    const uploaded = await upload;
    if (uploaded.error) throw uploaded.error;
    if (trackingPaused || !isRoundCurrent(account)) return;
    const response = uploaded.data;
    await applyPlaceUpdates({
      updates: {
        places: response.places,
        placeAlerts: response.placeAlerts,
        imageKeysNeedCatchUp: response.imageKeysNeedCatchUp,
        notices: response.notices,
      },
      round: account,
    });
  });

export const syncAccountNotices = async () => {
  if (getApiCompatibility()) return;
  await pollPlaceUpdates({ onlyWithoutKeys: true });
};

export const syncGroupNotices = async () => {
  if (getApiCompatibility()) return;
  await pollPlaceUpdates();
};

export type UploadReason = "upload" | "sharing" | "parked" | "push";

const syncBackgroundTrackingInternal = async (reason: UploadReason) => {
  await refreshSessionIfDue();
  if (getApiCompatibility()) {
    await refreshApiCompatibilityInBackground();
    if (!getApiCompatibility()) await dismissNotice("compatibility");
  }
  if (getApiCompatibility()) {
    await parkCaptureWhileBlocked();
    await showApiCompatibilityNotice();
    return;
  }
  if (reason === "parked") {
    await tryCatch(syncSharingPreference());
    await tryCatch(pollPlaceUpdates());
    return;
  }
  if (reason === "push") {
    await tryCatch(pollPlaceUpdates());
    return;
  }
  if (reason === "sharing" && (await hasFreshKeyCheck(true))) {
    const device = await getRegisteredDeviceKey();
    if (!device || !hasLocallyPausedSharing(device.userId)) await tryCatch(syncSharingPreference());
  }
  const reconciliation = await tryCatch(
    reconcileTrackingKeys({ startCapture: true, onlyIfRunning: true }),
  );
  if (getErrorCode(reconciliation.error) === "UNAUTHORIZED") return;
  uploadRejectedKeys = false;
  const result = await tryCatch(flushPendingTrackingPoints());
  if (getApiCompatibility()) {
    await parkCaptureWhileBlocked();
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

export const syncBackgroundTracking = async (reason: UploadReason = "upload") => {
  const synced = await tryCatch(syncBackgroundTrackingInternal(reason));
  await settleImageKeyCatchUps();
  if (synced.error) throw synced.error;
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

  const wasSharing = trackingModule.isCaptureRunning();
  try {
    trackingModule.revokeEpochKeys();
  } finally {
    await trackingModule.stopCapture();
  }
  if (revokeNotice) {
    await clearEventNotices({ keepSecurityAlerts: revokeNotice !== "deviceRemoved" });
  }
  if (revokeNotice && wasSharing) await showNotice({ kind: revokeNotice });
};

export const revokeTrackingAccess = ({
  cancelFlush = true,
  keepDeviceRegistration = false,
  notice,
}: {
  cancelFlush?: boolean;
  keepDeviceRegistration?: boolean;
  notice?: RevokeNotice;
} = {}): Promise<void> => {
  if (!keepDeviceRegistration) cancelDeviceKeyRegistrations();
  if (cancelFlush) {
    flushController?.abort();
    flushPromise = null;
    flushWork = null;
    flushController = null;
  }
  if (notice) revokeNotice = notice;
  if (revokePromise) {
    return revokePromise;
  }

  revokePromise = revokeTrackingAccessInternal().finally(() => {
    revokePromise = null;
    revokeNotice = null;
  });
  return revokePromise;
};

const revokeUnauthorizedTrackingAccess = async (
  error: unknown,
  { cancelFlush = true, round }: { cancelFlush?: boolean; round: AccountRound | null },
) => {
  if (round && !isRoundCurrent(round)) return;
  checkSessionAfterUnauthorized();
  refuseStartedRounds();
  const deviceRemoved = isDeviceRemovedError(error);
  return revokeTrackingAccess({
    cancelFlush,
    keepDeviceRegistration: deviceRemoved,
    notice: deviceRemoved ? "deviceRemoved" : "signedOut",
  });
};

export const getPushStatus = async () => {
  const trackingModule = await loadTrackingModule();
  const device = await getRegisteredDeviceKey();
  if (!trackingModule || !device) return null;
  return trackingModule.pushStatus(getPushScope(device));
};

export const forgetPushToken = async () => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return false;
  const device = await getRegisteredDeviceKey();
  return trackingModule.forgetPushToken(device ? getPushScope(device) : null);
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
        const clearPushToken = (await tryCatch(forgetPushToken())).data;
        await revokeTrackingAccess({ keepDeviceRegistration: true });
        if (clearPushToken) {
          await tryCatch(
            trpcClient.accountNotices.sync.mutate(
              { cursor: null, pushToken: null },
              { signal: controller.signal },
            ),
          );
        }
        if (previousFlush) await previousFlush;
        if (!controller.signal.aborted) {
          await flushPendingTrackingPointsInternal(true, controller.signal);
          await settleImageKeyCatchUps();
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
  deviceId: string | undefined;
  userId: string;
}) => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return;
  const owner = getOwner(userId);
  if (deviceId) await trackingModule.assignUnassignedCiphertexts(deviceId, owner);
  await trackingModule.deleteCiphertextsByOwner(owner);
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
  return count > 0 ? { count, deviceIds, server: getBaseUrl(), userId } : null;
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
