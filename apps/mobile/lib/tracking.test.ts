import { beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  encodeBase64,
  generateGroupEpochKey,
  unwrapHistoryEpochKey,
  type WrappedHistoryEpochKey,
  wrapEpochKeyForHistoryKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";
import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const deviceKeyPair = createDeviceKeyPair();
const historyKeyPair = createHistoryKeyPair();
const epochKey1 = generateGroupEpochKey();
const epochKey2 = generateGroupEpochKey();

const provisionedKeys: Array<{
  groupId: string;
  epochId: string;
  senderDeviceId: string;
  kind: string;
}> = [];
const provisionCalls: unknown[][] = [];
const revokedGroups: Array<string[] | null | undefined> = [];
const markedInFlight: number[][] = [];
const evictedBeforeClaim = new Set<number>();
const queueEvictions = new Map<
  string,
  { pointCount: number; oldestQueuedAt: number; newestQueuedAt: number; revision: number }
>();
const deleted: number[][] = [];
const deletedGroups: Array<{ owner: string; groupId: string }> = [];
let placeGroups: string[] | null = [];
const requeued: Array<{ ids: number[]; error: string | null | undefined }> = [];
const uploadCalls: Array<{
  groupId: string;
  points: Array<Record<string, unknown>>;
  placeTransitions?: { clientId: string; occurredAt?: Date }[];
  placeAlertsCursor?: string | null;
  noticesCursor?: string | null;
  drives?: { driveId: string }[];
}> = [];
let pendingPushToken: string | null = null;
const storedAccountCursor = "2026-11-17T08:00:00.000Z|";
const accountSyncResult = {
  notices: [],
  cursor: "2026-11-17T10:00:00.000Z|",
  pushAvailable: true,
};
const accountSyncCalls: Array<{ cursor: string | null; pushToken?: string | null }> = [];
let accountSyncResponse = async (): Promise<typeof accountSyncResult> => accountSyncResult;
let syncInBatch = false;
const uploadsBatchedWithSync: boolean[] = [];
const shownAccountNotices: Array<{ notices: unknown; round: { userId: string } }> = [];
let pushHeldByServer = false;
const pushConfirms: Array<{ scope: string; sent: string | null; pushAvailable: boolean }> = [];
const pushForgets: (string | null)[] = [];
let queuedTransitions: {
  clientId: string;
  senderDeviceId: string;
  groupId: string;
  placeId: string;
  direction: "ARRIVE" | "LEAVE";
  occurredAt: number;
}[] = [];
const deletedTransitions: string[][] = [];
type TestQueuedDrive = {
  id: number;
  groupId: string;
  driveId: string;
  epochId: string;
  senderDeviceId: string;
  startHour: number;
  nonce: string;
  ciphertext: string;
};
let queuedDrives: TestQueuedDrive[] = [];
const deletedDrives: number[][] = [];
const appliedPlaceUpdates: { updates: unknown; round: { userId: string } }[] = [];
let storedPlaceCursor: string | null = null;
const rotationChecks: string[] = [];
const requests: string[] = [];
const storageValues = new Map<string, string>();
let registeredDevice: {
  deviceId: string;
  privateKey: typeof deviceKeyPair.privateKey;
  userId: string;
} | null = null;
let membershipGroups: Array<{ id: string; members: Array<{ id: string }> }> = [];
const requestedOwners: string[] = [];
let currentUserId = "user-1";
let ownerContextCalls = 0;
let ownerQueryGate: Promise<void> | null = null;
let unassignedCount = 0;
const assignments: Array<{ deviceId: string; owner: string }> = [];
let pendingCiphertexts: Array<{
  id: number;
  clientPointId: string;
  captureId: string;
  groupId: string;
  epochId: string;
  senderDeviceId: string;
  kind: string;
  algorithm: string;
  nonce: string;
  ciphertext: string;
  role: "POINT" | "STAY" | "LIVE";
  capturedHour: number | null;
  queuedAt: number;
  attemptCount: number;
  lastAttemptAt: number | null;
  lastError: string | null;
  status: "PENDING" | "IN_FLIGHT";
  owner?: string;
}> = [];
const recordedUploads: Array<{ deviceId: string; groupId: string; timestamp: string }> = [];
let networkConnected = true;
let captureRunning = false;
let startCaptureCalls = 0;
let stopCaptureCalls = 0;
let onStopCapture: (() => void) | null = null;
let refreshCaptureCalls = 0;
let failRefreshCapture = false;
let failRevokeEpochKeys = false;
let failMembershipList = false;
let failRegistration = false;
let nativeQueueOwner: string | null = null;
let registrationError: Error | null = null;
let failRotation = false;
let rotationError: Error | null = null;
let failedGroup: string | null = null;
let failedLatestGroup: string | null = null;
let failedWrappedGroup: string | null = null;
let missingWrappedGroup: string | null = null;
let brokenGroupKey = false;
let historyOnlyGroup: string | null = null;
let recoveryStatus: {
  currentHistoryKey: { publicKey: string; version: number } | null;
  recoveryKey: object | null;
} | null = null;
let recoveryStatusError: Error | null = null;
let recoveryStatusCalls = 0;
const storedHistoryKeyVersions = new Set([1]);
let historyKeyReadError: Error | null = null;
let failedHistoryKeyReads = 0;
let createHistoryKeyResult: boolean | Error = true;
let thisDeviceActive = true;
let createHistoryKeyCalls = 0;
const resealedUsers: string[] = [];
let backfillErrors = new Map<string, Error>();
let missingHistoryWraps = new Map<string, string[]>();
const backfillQueries: string[] = [];
const captureStateSeenByBackfill: Array<{ provisions: number; starts: number }> = [];
const historyWrapUploads: Array<{ groupId: string; wraps: WrappedHistoryEpochKey[] }> = [];
let locationSharingError: Error | null = null;
let locationSharingCalls = 0;
const sharingStates: { owner: string; deviceId: string; prefix: string; paused: boolean }[] = [];
let registrationWait: Promise<void> | null = null;
let onRegistration: (() => void) | null = null;
const uploadAccounts: Array<string | undefined> = [];
let uploadGroup = async ({
  points,
}: {
  groupId: string;
  points: unknown[];
  placeTransitions?: { clientId: string }[];
  placeAlertsCursor?: string | null;
  drives?: { driveId: string }[];
}): Promise<{
  accepted: string[];
  duplicates: string[];
  expired?: string[];
  drives?: { accepted: string[]; duplicates: string[]; discarded: string[]; expired: string[] };
  keyState?: string;
  placeTransitions?: { accepted: string[]; duplicates: string[]; discarded: string[] };
  places?: { groupId: string; revision: number; needsCatchUp: boolean }[];
  placeAlerts?: { alerts: unknown[]; cursor: string };
  notices?: { notices: unknown[]; cursor: string };
}> => ({
  accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
  duplicates: [],
});

const storedNoticesCursor: string | null = "2026-11-17T09:00:00.000Z|";
mock.module("./secretStorage.ts", () => ({
  secretOwner: (userId: string) => ({ userId, generation: 0 }),
  invalidateSecretWrites: async () => {},
}));
let sessionChecks = 0;
mock.module("./sessionRefresh.ts", () => ({ refreshSessionIfDue: async () => {} }));
mock.module("./sessionCheck.ts", () => ({
  checkSessionAfterUnauthorized: () => {
    sessionChecks += 1;
  },
}));
mock.module("./trackingUploadTime.ts", () => ({
  recordTrackingUpload: (deviceId: string, groupId: string, timestamp: string) => {
    recordedUploads.push({ deviceId, groupId, timestamp });
  },
}));

mock.module("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => {} }),
  getNetworkStateAsync: async () => ({ isConnected: networkConnected }),
}));

mock.module("react-native", () => createReactNativeTestModule({ platformOS: "android" }));

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

mock.module("./registeredDevice.ts", () => ({
  readRegisteredDeviceNow: () => registeredDevice,
}));

mock.module("./deviceKeys.ts", () => ({
  getStoredDeviceId: () => registeredDevice?.deviceId,
  cancelDeviceKeyRegistrations: () => {
    registeredDevice = null;
  },
  forgetDeviceKeyRegistration: () => {
    registeredDevice = null;
  },
  getRegisteredDeviceKey: async () => registeredDevice,
  ensureDeviceKeyRegistration: async ({ checkOwner = false }: { checkOwner?: boolean } = {}) => {
    if (registeredDevice && !checkOwner) return registeredDevice;
    requests.push("auth.deviceKeyContext");
    if (registeredDevice?.userId === currentUserId) return registeredDevice;
    requests.push("auth.registerDeviceKey");
    if (registrationError) throw registrationError;
    if (failRegistration) throw new Error("offline");
    onRegistration?.();
    await registrationWait;
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: currentUserId,
    };
    return registeredDevice;
  },
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async ({ userId, version }: { userId: string; version: number }) => {
    if (historyKeyReadError) {
      failedHistoryKeyReads += 1;
      throw historyKeyReadError;
    }
    return userId === "user-1" && storedHistoryKeyVersions.has(version)
      ? historyKeyPair.privateKey
      : null;
  },
  storeHistoryKey: async () => {},
  deleteStoredHistoryKeys: async () => {},
}));

mock.module("./savedDeviceLink.ts", () => ({ deleteSavedDeviceLink: async () => {} }));

mock.module("./deviceActivation.ts", () => ({
  isThisDeviceActive: async () => thisDeviceActive,
}));

mock.module("./createHistoryKey.ts", () => ({
  KEY_NOT_SAVED_MESSAGE: "Unable to save your keys on this phone.",
  createHistoryKey: async () => {
    createHistoryKeyCalls += 1;
    if (createHistoryKeyResult instanceof Error) throw createHistoryKeyResult;
    if (createHistoryKeyResult) storedHistoryKeyVersions.add(1);
    recoveryStatus = {
      currentHistoryKey: {
        publicKey: createHistoryKeyResult
          ? historyKeyPair.publicKey
          : createHistoryKeyPair().publicKey,
        version: 1,
      },
      recoveryKey: null,
    };
    return createHistoryKeyResult;
  },
}));

mock.module("./resealPersonalData.ts", () => ({
  resealPersonalData: async (userId: string) => {
    resealedUsers.push(userId);
  },
}));

mock.module("./currentServer.ts", () => ({
  getBaseUrl: () => "https://api.example.test",
  hasCustomServerUrl: () => false,
}));

let apiCompatibility: {
  problem: "appTooOld" | "serverTooOld" | "outOfSync";
  serverVersion: string | null;
  notified: boolean;
} | null = null;
let apiCompatibilityRefreshClears = false;
let apiCompatibilityRefreshes = 0;
const notices: Record<string, unknown>[] = [];
let noticeAllowed = true;
const dismissedNotices: string[] = [];
let eventNoticeClears: { keepSecurityAlerts: boolean }[] = [];

mock.module("./notifications.ts", () => ({
  clearEventNotices: async (options: { keepSecurityAlerts: boolean }) => {
    eventNoticeClears.push(options);
  },
  showNotice: async (notice: Record<string, unknown>) => {
    if (!noticeAllowed) return false;
    notices.push(notice);
    return true;
  },
  dismissNotice: async (slot: string) => {
    dismissedNotices.push(slot);
  },
}));

mock.module("./placeBackgroundSync.ts", () => ({
  applyPlaceUpdates: async (input: { updates: unknown; round: { userId: string } }) => {
    appliedPlaceUpdates.push(input);
  },
  getPlaceAlertsCursor: () => storedPlaceCursor,
  settleImageKeyCatchUps: async () => {},
}));

mock.module("./noticeBackgroundSync.ts", () => ({
  getNoticesCursor: () => storedNoticesCursor,
  getAccountNoticesCursor: () => storedAccountCursor,
  showAccountNotices: async (input: { notices: unknown; round: { userId: string } }) => {
    shownAccountNotices.push(input);
  },
}));

mock.module("./apiCompatibility.ts", () => ({
  getApiCompatibility: () => apiCompatibility,
  refreshApiCompatibilityInBackground: async () => {
    apiCompatibilityRefreshes += 1;
    if (apiCompatibilityRefreshClears) apiCompatibility = null;
    return apiCompatibilityRefreshClears ? "ok" : null;
  },
  markApiCompatibilityNotified: () => {
    if (apiCompatibility) apiCompatibility = { ...apiCompatibility, notified: true };
  },
}));

mock.module("./api.ts", () => ({
  trpcClient: {
    account: {
      locationSharing: {
        query: async () => {
          locationSharingCalls += 1;
          if (locationSharingError) throw locationSharingError;
          const preference = {
            sharingPaused: false,
            sharingPausedUntil: null,
            sharingChangedAt: null,
            sharingRevision: 0,
          };
          return {
            account: preference,
            device: preference,
            userId: currentUserId,
            deviceId: "device-1",
            serverTime: new Date(),
            historyShare: { account: "MAXIMUM" as const, changedAt: null, groups: [] },
            paused: false,
            pausedUntil: null,
            resumeAfter: null,
            revisionPrefix: "",
          };
        },
      },
    },
    auth: {
      deviceKeyContext: {
        query: async () => {
          requests.push("auth.deviceKeyContext");
          ownerContextCalls += 1;
          await ownerQueryGate;
          return { userId: currentUserId, recipients: [{ deviceId: "device-1" }] };
        },
      },
    },
    accountRecovery: {
      status: {
        query: async () => {
          requests.push("accountRecovery.status");
          recoveryStatusCalls += 1;
          if (recoveryStatusError) throw recoveryStatusError;
          return (
            recoveryStatus ?? {
              currentHistoryKey: { publicKey: historyKeyPair.publicKey, version: 1 },
              recoveryKey: {},
            }
          );
        },
      },
    },
    groupMembership: {
      list: {
        query: async () => {
          requests.push("groupMembership.list");
          if (failMembershipList) throw new Error("Network request failed");
          return membershipGroups;
        },
      },
    },
    groupEpoch: {
      listHistoryBackfill: {
        query: async ({ groupId }: { groupId: string }) => {
          requests.push("groupEpoch.listHistoryBackfill");
          backfillQueries.push(groupId);
          captureStateSeenByBackfill.push({
            provisions: provisionCalls.length,
            starts: startCaptureCalls,
          });
          const backfillError = backfillErrors.get(groupId);
          if (backfillError) throw backfillError;
          return {
            epochs: (missingHistoryWraps.get(groupId) ?? []).map((epochId, index) => ({
              deviceWrap: wrapEpochKeyForRecipient({
                epoch: {
                  createdAt: new Date(0),
                  createdByDeviceId: "device-0",
                  epochId,
                  epochNumber: index + 1,
                  groupId,
                },
                epochKey: epochId === "epoch-1" ? epochKey1 : epochKey2,
                recipient: {
                  algorithm: DEVICE_KEY_ALGORITHM,
                  createdAt: new Date(0),
                  deviceId: "device-1",
                  publicKey: deviceKeyPair.publicKey,
                  revokedAt: null,
                  userId: "user-1",
                },
                senderPrivateKey: deviceKeyPair.privateKey,
              }),
              epochId,
              epochNumber: index + 1,
            })),
            historyKey: {
              id: "019a0000-0000-7000-8000-000000000001",
              publicKey: historyKeyPair.publicKey,
              userId: "user-1",
              version: 1,
            },
            nextCursor: null,
          };
        },
      },
      addHistoryWraps: {
        mutate: async (input: { groupId: string; wraps: WrappedHistoryEpochKey[] }) => {
          requests.push("groupEpoch.addHistoryWraps");
          historyWrapUploads.push(input);
          missingHistoryWraps.delete(input.groupId);
          return { added: input.wraps.length };
        },
      },
      rotationContext: {
        query: async ({ groupId }: { groupId: string }) => {
          requests.push("groupEpoch.rotationContext");
          rotationChecks.push(groupId);
          if (rotationError && groupId === "group-1") throw rotationError;
          if (failRotation || groupId === failedGroup) throw new Error("Rotation unavailable");
          return null;
        },
      },
      getLatest: {
        query: async ({ groupId }: { groupId: string }) => {
          requests.push("groupEpoch.getLatest");
          if (groupId === failedLatestGroup) throw new Error("Latest epoch unavailable");
          return { epochId: groupId === "group-1" ? "epoch-1" : "epoch-2", groupId };
        },
      },
      getEpochKeyWraps: {
        query: async ({ epochId, groupId }: { epochId: string; groupId: string }) => {
          requests.push("groupEpoch.getEpochKeyWraps");
          if (groupId === failedWrappedGroup) throw new Error("Wrapped key unavailable");
          if (groupId === missingWrappedGroup) return { deviceWrap: null, historyWraps: [] };
          if (groupId === historyOnlyGroup) {
            const historyWrap = wrapEpochKeyForHistoryKey({
              epochId,
              epochKey: epochId === "epoch-1" ? epochKey1 : epochKey2,
              historyKey: { publicKey: historyKeyPair.publicKey, userId: "user-1", version: 1 },
              senderPrivateKey: deviceKeyPair.privateKey,
            });
            return { deviceWrap: null, historyWraps: [{ ...historyWrap, createdAt: new Date(0) }] };
          }
          const deviceWrap = wrapEpochKeyForRecipient({
            epoch: {
              createdAt: new Date(0),
              createdByDeviceId: "device-1",
              epochId,
              epochNumber: epochId === "epoch-1" ? 1 : 2,
              groupId,
            },
            epochKey: epochId === "epoch-1" ? epochKey1 : epochKey2,
            recipient: {
              algorithm: DEVICE_KEY_ALGORITHM,
              createdAt: new Date(0),
              deviceId: "device-1",
              publicKey:
                brokenGroupKey && groupId === "group-1"
                  ? createDeviceKeyPair().publicKey
                  : deviceKeyPair.publicKey,
              revokedAt: null,
              userId: "user-1",
            },
            senderPrivateKey: deviceKeyPair.privateKey,
          });
          return { deviceWrap, historyWraps: [] };
        },
      },
    },
    accountNotices: {
      sync: {
        mutate: async (input: { cursor: string | null; pushToken?: string | null }) => {
          accountSyncCalls.push(input);
          syncInBatch = true;
          setTimeout(() => {
            syncInBatch = false;
          });
          return accountSyncResponse();
        },
      },
    },
    groupTracking: {
      uploadBatch: {
        mutate: async (
          input: {
            groupId: string;
            points: Array<Record<string, unknown>>;
            placeTransitions?: { clientId: string; occurredAt?: Date }[];
            placeAlertsCursor?: string | null;
            noticesCursor?: string | null;
          },
          options?: { context?: { accountRound?: { userId: string } } },
        ) => {
          requests.push("groupTracking.uploadBatch");
          uploadCalls.push(input);
          uploadAccounts.push(options?.context?.accountRound?.userId);
          uploadsBatchedWithSync.push(syncInBatch);
          return uploadGroup(input);
        },
      },
    },
  },
}));

mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    setSharingState: (owner: string, deviceId: string, prefix: string, paused: boolean) => {
      sharingStates.push({ owner, deviceId, prefix, paused });
      return true;
    },
    setHistoryShare: () => true,
    setQueueOwner: (owner: string, deviceId: string) => {
      nativeQueueOwner = JSON.stringify([owner, deviceId]);
    },
    isQueueOwner: (owner: string, deviceId: string) =>
      nativeQueueOwner === JSON.stringify([owner, deviceId]),
    countUnassignedCiphertexts: async () => unassignedCount,
    assignUnassignedCiphertexts: async (deviceId: string, owner: string) => {
      assignments.push({ deviceId, owner });
    },
    provisionEpochKeys: (keys: unknown[], preserveGroupIds: string[] = []) => {
      provisionCalls.push(keys);
      const remaining = provisionedKeys.filter(({ groupId }) => preserveGroupIds.includes(groupId));
      provisionedKeys.splice(
        0,
        provisionedKeys.length,
        ...remaining,
        ...(keys as typeof provisionedKeys),
      );
    },
    revokeEpochKeys: (groupIds?: string[] | null) => {
      revokedGroups.push(groupIds);
      if (failRevokeEpochKeys) throw new Error("revoke failed");
      const kept = provisionedKeys.filter(({ groupId }) => groupIds && !groupIds.includes(groupId));
      provisionedKeys.splice(0, provisionedKeys.length, ...kept);
    },
    listProvisionedEpochKeys: () => provisionedKeys,
    pendingPushToken: () => pendingPushToken,
    confirmPushToken: (scope: string, sent: string | null, pushAvailable: boolean) => {
      pushConfirms.push({ scope, sent, pushAvailable });
    },
    forgetPushToken: (scope: string | null) => {
      pushForgets.push(scope);
      const held = pushHeldByServer;
      pendingPushToken = null;
      pushHeldByServer = false;
      return held;
    },
    startCapture: async () => {
      startCaptureCalls += 1;
    },
    refreshCapture: async () => {
      refreshCaptureCalls += 1;
      if (failRefreshCapture) throw new Error("refresh failed");
    },
    stopCapture: async () => {
      stopCaptureCalls += 1;
      captureRunning = false;
      onStopCapture?.();
    },
    isCaptureRunning: () => captureRunning,
    listPendingCiphertexts: async (owner: string, limit = 100, afterId = 0) => {
      requestedOwners.push(owner);
      return pendingCiphertexts
        .filter((item) => item.id > afterId && (item.owner === undefined || item.owner === owner))
        .slice(0, limit);
    },
    markCiphertextsInFlight: async (ids: number[]) => {
      markedInFlight.push(ids);
      return ids.filter((id) => !evictedBeforeClaim.has(id));
    },
    getCiphertextEviction: async (owner: string) => queueEvictions.get(owner) ?? null,
    acknowledgeCiphertextEviction: async (owner: string, revision: number) => {
      if (queueEvictions.get(owner)?.revision === revision) queueEvictions.delete(owner);
    },
    deleteCiphertexts: async (ids: number[]) => {
      deleted.push(ids);
    },
    deleteCiphertextsByGroup: async (owner: string, groupId: string) => {
      deletedGroups.push({ owner, groupId });
      pendingCiphertexts = pendingCiphertexts.filter((item) => item.groupId !== groupId);
    },
    requeueCiphertexts: async (ids: number[], error?: string | null) => {
      requeued.push({ ids, error });
    },
    listPlaceGroups: () => placeGroups,
    listPlaceTransitions: async () => queuedTransitions,
    deletePlaceTransitions: async (clientIds: string[]) => {
      deletedTransitions.push(clientIds);
      queuedTransitions = queuedTransitions.filter(({ clientId }) => !clientIds.includes(clientId));
    },
    listQueuedDrives: async () => queuedDrives,
    deleteQueuedDrives: async (ids: number[]) => {
      deletedDrives.push(ids);
      queuedDrives = queuedDrives.filter(({ id }) => !ids.includes(id));
    },
  },
}));

const {
  dismissTrackingQueueEviction,
  flushForegroundTrackingPoints,
  flushPendingTrackingPoints,
  getTrackingQueueEviction,
  getUnassignedTrackingPoints,
  prepareTrackingSignOut,
  reconcileTrackingKeys,
  recoverUnassignedTrackingPoints,
  resumeTracking,
  revokeTrackingAccess,
  syncAccountNotices,
  syncBackgroundTracking,
  takeKeyAccessChange,
} = await import("./tracking.ts");
const { noteGroupMembership } = await import("./trackingKeyCheck.ts");

const pointId = (label: string) =>
  encodeBase64(new Uint8Array(createHash("sha256").update(label).digest()).slice(0, 8));
const queuedNonce = encodeBase64(new Uint8Array(24).fill(2));
const queuedCiphertext = encodeBase64(new Uint8Array(39).fill(1));

const createQueueItem = ({
  capturedHour = null,
  clientPointId,
  groupId,
  id,
  role = "POINT",
  senderDeviceId = "device-1",
}: {
  capturedHour?: number | null;
  clientPointId: string;
  groupId: string;
  id: number;
  role?: "POINT" | "STAY" | "LIVE";
  senderDeviceId?: string;
}) => ({
  id,
  clientPointId: pointId(clientPointId),
  captureId: `capture-${id}`,
  groupId,
  epochId: `epoch-${groupId.slice(-1)}`,
  senderDeviceId,
  kind: "trackingPoint",
  algorithm: "XChaCha20-Poly1305",
  nonce: queuedNonce,
  ciphertext: queuedCiphertext,
  role,
  capturedHour,
  queuedAt: id,
  attemptCount: 0,
  lastAttemptAt: null,
  lastError: null,
  status: "PENDING" as const,
});

describe("tracking service", () => {
  beforeEach(() => {
    provisionedKeys.length = 0;
    provisionCalls.length = 0;
    revokedGroups.length = 0;
    markedInFlight.length = 0;
    evictedBeforeClaim.clear();
    queueEvictions.clear();
    deleted.length = 0;
    deletedGroups.length = 0;
    placeGroups = [];
    requeued.length = 0;
    uploadCalls.length = 0;
    rotationChecks.length = 0;
    requests.length = 0;
    storageValues.clear();
    registeredDevice = null;
    membershipGroups = [
      { id: "group-1", members: [{ id: "member-1" }] },
      { id: "group-2", members: [{ id: "member-2" }] },
    ];
    requestedOwners.length = 0;
    currentUserId = "user-1";
    apiCompatibility = null;
    apiCompatibilityRefreshClears = false;
    apiCompatibilityRefreshes = 0;
    notices.length = 0;
    noticeAllowed = true;
    dismissedNotices.length = 0;
    storedHistoryKeyVersions.clear();
    storedHistoryKeyVersions.add(1);
    historyKeyReadError = null;
    createHistoryKeyResult = true;
    createHistoryKeyCalls = 0;
    thisDeviceActive = true;
    resealedUsers.length = 0;
    ownerContextCalls = 0;
    ownerQueryGate = null;
    unassignedCount = 0;
    assignments.length = 0;
    resumeTracking();
    recordedUploads.length = 0;
    pendingCiphertexts = [];
    captureRunning = false;
    networkConnected = true;
    startCaptureCalls = 0;
    stopCaptureCalls = 0;
    onStopCapture = null;
    refreshCaptureCalls = 0;
    failRefreshCapture = false;
    failRevokeEpochKeys = false;
    failMembershipList = false;
    failRegistration = false;
    nativeQueueOwner = null;
    registrationError = null;
    failRotation = false;
    rotationError = null;
    failedGroup = null;
    failedLatestGroup = null;
    failedWrappedGroup = null;
    missingWrappedGroup = null;
    brokenGroupKey = false;
    historyOnlyGroup = null;
    recoveryStatus = null;
    recoveryStatusError = null;
    recoveryStatusCalls = 0;
    backfillErrors = new Map();
    missingHistoryWraps = new Map();
    backfillQueries.length = 0;
    captureStateSeenByBackfill.length = 0;
    historyWrapUploads.length = 0;
    registrationWait = null;
    onRegistration = null;
    locationSharingError = null;
    locationSharingCalls = 0;
    sharingStates.length = 0;
    uploadGroup = async ({ points }) => ({
      accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
      duplicates: [],
    });
    queuedTransitions = [];
    queuedDrives = [];
    deletedDrives.length = 0;
    deletedTransitions.length = 0;
    appliedPlaceUpdates.length = 0;
    storedPlaceCursor = null;
    pendingPushToken = null;
    pushHeldByServer = false;
    pushConfirms.length = 0;
    sessionChecks = 0;
    pushForgets.length = 0;
    accountSyncCalls.length = 0;
    accountSyncResponse = async () => accountSyncResult;
    uploadsBatchedWithSync.length = 0;
    shownAccountNotices.length = 0;
  });

  describe("account notices and push token", () => {
    const scope = JSON.stringify(["https://api.example.test", "user-1", "device-1"]);

    beforeEach(() => {
      registeredDevice = {
        deviceId: "device-1",
        privateKey: deviceKeyPair.privateKey,
        userId: "user-1",
      };
      provisionedKeys.push({
        groupId: "group-1",
        epochId: "epoch-1",
        senderDeviceId: "device-1",
        kind: "trackingPoint",
      });
    });

    test("an upload round asks for account notices in the same request as its first upload", async () => {
      pendingPushToken = "token-1";
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 }),
        createQueueItem({ clientPointId: "p2", groupId: "group-2", id: 2 }),
      ];
      await flushPendingTrackingPoints();
      expect(uploadCalls).toHaveLength(2);
      expect(uploadCalls.every((call) => !("pushToken" in call))).toBe(true);
      expect(accountSyncCalls).toEqual([{ cursor: storedAccountCursor, pushToken: "token-1" }]);
      expect(uploadsBatchedWithSync[0]).toBe(true);
      expect(pushConfirms).toEqual([{ scope, sent: "token-1", pushAvailable: true }]);
      expect(shownAccountNotices).toEqual([
        { notices: accountSyncResult, round: expect.objectContaining({ userId: "user-1" }) },
      ]);
    });

    test("an upload round with nothing to send doesn't ask for account notices", async () => {
      await flushPendingTrackingPoints();
      expect(accountSyncCalls).toEqual([]);
    });

    test("a push checks account notices alongside the cursor-only upload", async () => {
      captureRunning = true;
      pendingPushToken = "token-1";
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      await syncBackgroundTracking("push");
      expect(uploadCalls).toEqual([
        {
          groupId: "group-1",
          points: [],
          placeAlertsCursor: null,
          noticesCursor: "2026-11-17T09:00:00.000Z|",
        },
      ]);
      expect(uploadsBatchedWithSync).toEqual([true]);
      expect(accountSyncCalls).toEqual([{ cursor: storedAccountCursor, pushToken: "token-1" }]);
      expect(pushConfirms).toEqual([{ scope, sent: "token-1", pushAvailable: true }]);
      expect(locationSharingCalls).toBe(0);
      expect(provisionCalls).toHaveLength(0);
    });

    test("a push or parked check on a phone in no group still checks account notices", async () => {
      provisionedKeys.length = 0;
      pendingPushToken = "token-1";
      await syncBackgroundTracking("push");
      await syncBackgroundTracking("parked");
      expect(uploadCalls).toEqual([]);
      expect(accountSyncCalls).toEqual([
        { cursor: storedAccountCursor, pushToken: "token-1" },
        { cursor: storedAccountCursor, pushToken: "token-1" },
      ]);
      expect(shownAccountNotices).toHaveLength(2);
    });

    test("a phone without location permission still gets place alerts and group notices", async () => {
      await reconcileTrackingKeys({ startCapture: false, force: true });
      expect(provisionedKeys).toHaveLength(0);
      const cursorOnly = {
        groupId: "group-1",
        points: [],
        placeAlertsCursor: null,
        noticesCursor: "2026-11-17T09:00:00.000Z|",
      };

      await syncBackgroundTracking("push");
      expect(uploadCalls).toEqual([cursorOnly]);
      expect(uploadsBatchedWithSync).toEqual([true]);

      await syncAccountNotices();
      expect(uploadCalls).toEqual([cursorOnly, cursorOnly]);
      expect(uploadsBatchedWithSync).toEqual([true, true]);
      expect(accountSyncCalls).toHaveLength(2);
    });

    test("coming to the foreground on a sharing phone leaves place alerts to its uploads", async () => {
      expect(provisionedKeys.length).toBeGreaterThan(0);
      await syncAccountNotices();
      expect(uploadCalls).toEqual([]);
      expect(accountSyncCalls).toEqual([{ cursor: storedAccountCursor }]);
    });

    test("coming to the foreground checks account notices without a group", async () => {
      provisionedKeys.length = 0;
      await syncAccountNotices();
      expect(accountSyncCalls).toEqual([{ cursor: storedAccountCursor }]);
      expect(pushConfirms).toEqual([{ scope, sent: null, pushAvailable: true }]);
    });

    test("the server's answer says whether the phone should get a token", async () => {
      accountSyncResponse = async () => ({ ...accountSyncResult, pushAvailable: false });
      await syncAccountNotices();
      expect(accountSyncCalls[0]).not.toHaveProperty("pushToken");
      expect(pushConfirms).toEqual([{ scope, sent: null, pushAvailable: false }]);
    });

    test("a failed check confirms nothing and shows nothing", async () => {
      pendingPushToken = "token-1";
      accountSyncResponse = async () => {
        throw new Error("offline");
      };
      await syncAccountNotices();
      expect(accountSyncCalls).toEqual([{ cursor: storedAccountCursor, pushToken: "token-1" }]);
      expect(pushConfirms).toEqual([]);
      expect(shownAccountNotices).toEqual([]);
    });

    test("a rejected session asks for the session to be checked and confirms nothing", async () => {
      pendingPushToken = "token-1";
      accountSyncResponse = async () => {
        throw Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } });
      };
      await syncAccountNotices();
      expect(sessionChecks).toBe(1);
      expect(pushConfirms).toEqual([]);
      expect(shownAccountNotices).toEqual([]);
    });

    test("a push while signing out sends no token and shows nothing", async () => {
      pendingPushToken = "token-1";
      const signingOut = prepareTrackingSignOut();
      await syncBackgroundTracking("push");
      await syncAccountNotices();
      await signingOut;
      expect(accountSyncCalls.filter((call) => call.pushToken !== undefined)).toEqual([]);
      expect(pushConfirms).toEqual([]);
      expect(shownAccountNotices).toEqual([]);
    });

    test("signing out tells the server to drop a token it holds, even in no group", async () => {
      provisionedKeys.length = 0;
      pushHeldByServer = true;
      await prepareTrackingSignOut();
      expect(pushForgets).toEqual([scope]);
      expect(accountSyncCalls).toEqual([{ cursor: null, pushToken: null }]);
      expect(uploadCalls).toEqual([]);
      expect(pushConfirms).toEqual([]);
      expect(shownAccountNotices).toEqual([]);
    });

    test("a phone whose registration is already gone still forgets its push token", async () => {
      registeredDevice = null;
      await prepareTrackingSignOut();
      expect(pushForgets).toEqual([null]);
    });

    test("signing out sends no null when the server never had the token", async () => {
      await prepareTrackingSignOut();
      expect(pushForgets).toEqual([scope]);
      expect(accountSyncCalls).toEqual([]);
    });

    test("the last upload while signing out asks for no token, alerts or notices", async () => {
      pushHeldByServer = true;
      pendingPushToken = "token-1";
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      uploadGroup = async ({ points }) => ({
        accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
        duplicates: [],
        notices: { notices: [], cursor: "2026-11-17T10:00:00.000Z|" },
      });
      await prepareTrackingSignOut();
      expect(accountSyncCalls).toEqual([{ cursor: null, pushToken: null }]);
      expect(uploadCalls).toEqual([{ groupId: "group-1", points: [expect.anything()] }]);
      expect(pushConfirms).toEqual([]);
      expect(appliedPlaceUpdates).toEqual([]);
      expect(shownAccountNotices).toEqual([]);
    });

    test("a push that arrives during an upload waits for it, so the cursor is sent once at a time", async () => {
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      const events: string[] = [];
      let releaseUpload = () => {};
      const uploadHeld = new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      uploadGroup = async ({ points }) => {
        events.push(points.length > 0 ? "upload started" : "push started");
        if (points.length > 0) await uploadHeld;
        events.push(points.length > 0 ? "upload finished" : "push finished");
        return {
          accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
          duplicates: [],
        };
      };
      const flush = flushPendingTrackingPoints();
      await Bun.sleep(0);
      const push = syncBackgroundTracking("push");
      await Bun.sleep(5);
      expect(events).toEqual(["upload started"]);
      expect(accountSyncCalls).toHaveLength(1);
      releaseUpload();
      await Promise.all([flush, push]);
      expect(events).toEqual([
        "upload started",
        "upload finished",
        "push started",
        "push finished",
      ]);
      expect(accountSyncCalls).toHaveLength(2);
    });
  });

  describe("place transitions and alerts", () => {
    const t1 = "00000000-0000-4000-8000-000000000001";
    const old = "00000000-0000-4000-8000-000000000009";
    const transition = (clientId: string, groupId = "group-1", senderDeviceId = "device-1") => ({
      clientId,
      senderDeviceId,
      groupId,
      placeId: `place-${groupId}`,
      direction: "ARRIVE" as const,
      occurredAt: 1_000,
    });
    const placeAnswer = (input: {
      points: unknown[];
      drives?: { driveId: string }[];
      placeTransitions?: { clientId: string }[];
      placeAlertsCursor?: string | null;
      noticesCursor?: string | null;
    }) => ({
      accepted: input.points.map((point) => (point as { clientPointId: string }).clientPointId),
      duplicates: [],
      ...(input.drives
        ? {
            drives: {
              accepted: input.drives.map(({ driveId }) => driveId),
              duplicates: [],
              discarded: [],
              expired: [],
            },
          }
        : {}),
      ...(input.placeTransitions
        ? {
            placeTransitions: {
              accepted: input.placeTransitions.map(({ clientId }) => clientId),
              duplicates: [],
              discarded: [],
            },
          }
        : {}),
      ...(input.placeAlertsCursor !== undefined
        ? {
            places: [{ groupId: "group-1", revision: 3, needsCatchUp: false }],
            placeAlerts: { alerts: [], cursor: "2026-11-15T10:00:00.000Z|" },
          }
        : {}),
      ...(input.noticesCursor !== undefined
        ? { notices: { notices: [], cursor: "2026-11-17T10:00:00.000Z|" } }
        : {}),
    });

    beforeEach(() => {
      registeredDevice = {
        deviceId: "device-1",
        privateKey: deviceKeyPair.privateKey,
        userId: "user-1",
      };
      uploadGroup = async (input) => placeAnswer(input);
    });

    test("a round whose session is rejected part-way applies none of its updates", async () => {
      storedPlaceCursor = "2026-11-15T09:00:00.000Z|";
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 }),
        createQueueItem({ clientPointId: "p2", groupId: "group-2", id: 2 }),
      ];
      uploadGroup = async (input) => {
        if (input.groupId === "group-2") {
          throw Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } });
        }
        return placeAnswer(input);
      };

      await expect(flushPendingTrackingPoints()).rejects.toThrow();

      expect(uploadCalls.some((call) => call.placeAlertsCursor !== undefined)).toBe(true);
      expect(appliedPlaceUpdates).toEqual([]);
      expect(shownAccountNotices).toEqual([]);
    });

    test("a transition's time is sent on the server's clock", async () => {
      storageValues.set(
        `locationSharing.clockOffset.${JSON.stringify("https://api.example.test")}`,
        "-600000",
      );
      queuedTransitions = [{ ...transition(t1), occurredAt: 1_800_000 }];
      await flushPendingTrackingPoints();
      expect(
        uploadCalls.flatMap((call) => call.placeTransitions ?? []).map((sent) => sent.occurredAt),
      ).toEqual([new Date(1_200_000)]);
    });

    test("transitions ride with their group's points and the cursor goes on one upload", async () => {
      storedPlaceCursor = "2026-11-15T09:00:00.000Z|";
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 }),
        createQueueItem({ clientPointId: "p2", groupId: "group-2", id: 2 }),
      ];
      queuedTransitions = [transition(t1)];
      await flushPendingTrackingPoints();
      expect(uploadCalls).toHaveLength(2);
      const withTransitions = uploadCalls.find((call) => call.groupId === "group-1");
      expect(withTransitions?.placeTransitions?.map(({ clientId }) => clientId)).toEqual([t1]);
      expect(uploadCalls.filter((call) => call.placeAlertsCursor !== undefined)).toEqual([
        expect.objectContaining({
          placeAlertsCursor: "2026-11-15T09:00:00.000Z|",
          noticesCursor: "2026-11-17T09:00:00.000Z|",
        }),
      ]);
      expect(uploadCalls.filter((call) => call.noticesCursor !== undefined)).toHaveLength(1);
      expect(deletedTransitions).toEqual([[t1]]);
      expect(appliedPlaceUpdates).toEqual([
        {
          round: expect.objectContaining({ userId: "user-1" }),
          updates: {
            places: [{ groupId: "group-1", revision: 3, needsCatchUp: false }],
            placeAlerts: { alerts: [], cursor: "2026-11-15T10:00:00.000Z|" },
            notices: { notices: [], cursor: "2026-11-17T10:00:00.000Z|" },
          },
        },
      ]);
    });

    const flushAt = async (times: number[], beforeFlush: (index: number) => void = () => {}) => {
      const clock = spyOn(Date, "now");
      try {
        for (const [index, time] of times.entries()) {
          clock.mockReturnValue(time);
          pendingCiphertexts = [
            createQueueItem({ clientPointId: `p${index}`, groupId: "group-1", id: index + 1 }),
          ];
          beforeFlush(index);
          await flushPendingTrackingPoints();
        }
      } finally {
        clock.mockRestore();
      }
    };
    const askedForCatchUp = () => uploadCalls.map((call) => call.placeAlertsCursor !== undefined);

    test("an upload just after a push poll leaves out the alerts and account notices", async () => {
      storedPlaceCursor = "2026-11-15T09:00:00.000Z|";
      await syncBackgroundTracking("push");
      const pollUploads = uploadCalls.length;
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      await flushPendingTrackingPoints();

      expect(uploadCalls.slice(pollUploads).map((call) => call.placeAlertsCursor)).toEqual([
        undefined,
      ]);
      expect(accountSyncCalls).toHaveLength(1);
    });

    test("uploads less than a minute apart ask for alerts and account notices once", async () => {
      storedPlaceCursor = "2026-11-15T09:00:00.000Z|";
      const startedAt = Date.now();
      await flushAt([0, 10_000, 20_000, 60_000].map((sinceStartMs) => startedAt + sinceStartMs));

      expect(askedForCatchUp()).toEqual([true, false, false, true]);
      expect(accountSyncCalls).toHaveLength(2);
    });

    test("a clock set backwards doesn't hold back alerts and account notices", async () => {
      const startedAt = Date.now();
      await flushAt([startedAt, startedAt - 3_600_000, startedAt - 3_590_000]);

      expect(askedForCatchUp()).toEqual([true, true, false]);
      expect(accountSyncCalls).toHaveLength(2);
    });

    test("resuming sharing asks for alerts and account notices on the next upload", async () => {
      const startedAt = Date.now();
      await flushAt([startedAt, startedAt + 10_000], (index) => {
        if (index === 1) resumeTracking();
      });

      expect(askedForCatchUp()).toEqual([true, true]);
      expect(accountSyncCalls).toHaveLength(2);
    });

    test("arrivals and departures are sent in rounds that don't ask for alerts", async () => {
      const startedAt = Date.now();
      await flushAt([startedAt, startedAt + 10_000], (index) => {
        if (index === 1) queuedTransitions = [transition(t1), transition(old, "group-2")];
      });

      expect(uploadCalls.slice(1)).toEqual([
        expect.objectContaining({
          groupId: "group-1",
          placeTransitions: [expect.objectContaining({ clientId: t1 })],
        }),
        expect.objectContaining({
          groupId: "group-2",
          points: [],
          placeTransitions: [expect.objectContaining({ clientId: old })],
        }),
      ]);
      expect(askedForCatchUp()).toEqual([true, false, false]);
      expect(deletedTransitions.flat().sort()).toEqual([t1, old]);
    });

    test("a group with only transitions gets an upload of its own, and the first one asks for alerts from now", async () => {
      queuedTransitions = [transition(t1, "group-2")];
      await flushPendingTrackingPoints();
      expect(uploadCalls).toEqual([
        expect.objectContaining({ groupId: "group-2", points: [], placeAlertsCursor: null }),
      ]);
      expect(deletedTransitions).toEqual([[t1]]);
    });

    test("transitions from an earlier device are dropped, never sent", async () => {
      queuedTransitions = [transition(old, "group-1", "device-0"), transition(t1)];
      await flushPendingTrackingPoints();
      expect(deletedTransitions[0]).toEqual([old]);
      expect(uploadCalls.flatMap((call) => call.placeTransitions ?? [])).toEqual([
        expect.objectContaining({ clientId: t1 }),
      ]);
    });

    test("a transition the server wouldn't accept is dropped, never sent", async () => {
      queuedTransitions = [{ ...transition(t1), clientId: "not-a-uuid" }, transition(old)];
      await flushPendingTrackingPoints();
      expect(deletedTransitions[0]).toEqual(["not-a-uuid"]);
      expect(uploadCalls.flatMap((call) => call.placeTransitions ?? [])).toEqual([
        expect.objectContaining({ clientId: old }),
      ]);
    });

    test("points from an earlier device don't carry this phone's transitions", async () => {
      pendingCiphertexts = [
        createQueueItem({
          clientPointId: "old",
          groupId: "group-1",
          id: 1,
          senderDeviceId: "device-0",
        }),
      ];
      queuedTransitions = [transition(t1)];
      await flushPendingTrackingPoints();
      const oldDeviceUpload = uploadCalls.find((call) => call.points.length > 0);
      expect(oldDeviceUpload?.placeTransitions).toBeUndefined();
      expect(oldDeviceUpload?.placeAlertsCursor).toBeUndefined();
      expect(uploadCalls.find((call) => call.points.length === 0)?.placeTransitions).toEqual([
        expect.objectContaining({ clientId: t1 }),
      ]);
    });

    test("a failed upload keeps the transitions queued and doesn't touch the cursor", async () => {
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      queuedTransitions = [transition(t1)];
      uploadGroup = async () => {
        throw new Error("Network request failed");
      };
      await expect(flushPendingTrackingPoints()).rejects.toThrow();
      expect(deletedTransitions).toEqual([]);
      expect(queuedTransitions).toHaveLength(1);
      expect(appliedPlaceUpdates).toEqual([]);
    });

    test("a refused request with transitions retries the points alone, then the transitions alone", async () => {
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      queuedTransitions = [transition(t1)];
      uploadGroup = async (input) => {
        if (input.placeTransitions && input.points.length > 0) {
          throw Object.assign(new Error("Bad request"), { data: { code: "BAD_REQUEST" } });
        }
        if (input.placeTransitions) {
          throw Object.assign(new Error("Bad request"), { data: { code: "BAD_REQUEST" } });
        }
        return placeAnswer(input);
      };
      await flushPendingTrackingPoints();
      expect(deleted).toEqual([[1]]);
      expect(deletedTransitions).toEqual([[t1]]);
    });

    const queuedDrive = (id: number, groupId = "group-1", senderDeviceId = "device-1") => ({
      id,
      groupId,
      driveId: id.toString(16).padStart(32, "0"),
      epochId: `epoch-${groupId.slice(-1)}`,
      senderDeviceId,
      startHour: Math.floor(Date.now() / 3_600_000) - 1,
      nonce: queuedNonce,
      ciphertext: encodeBase64(new Uint8Array(1_024).fill(3)),
    });

    test("a finished Drive rides with its group's next point batch and leaves the queue once answered", async () => {
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      queuedDrives = [queuedDrive(7)];
      await flushPendingTrackingPoints();
      expect(uploadCalls).toEqual([
        expect.objectContaining({
          groupId: "group-1",
          points: [expect.anything()],
          drives: [
            {
              ciphertext: queuedDrive(7).ciphertext,
              driveId: queuedDrive(7).driveId,
              epochId: "epoch-1",
              nonce: queuedNonce,
              senderDeviceId: "device-1",
              startHour: queuedDrive(7).startHour,
            },
          ],
        }),
      ]);
      expect(deletedDrives).toEqual([[7]]);
    });

    test("a group with only a queued Drive gets an upload of its own", async () => {
      queuedDrives = [queuedDrive(8, "group-2")];
      await flushPendingTrackingPoints();
      expect(uploadCalls).toEqual([
        expect.objectContaining({ groupId: "group-2", points: [], drives: [expect.anything()] }),
      ]);
      expect(queuedDrives).toEqual([]);
    });

    test("Drives the server discards or whose Epoch is gone leave the queue", async () => {
      queuedDrives = [queuedDrive(1), queuedDrive(2), queuedDrive(3)];
      uploadGroup = async () => ({
        accepted: [],
        duplicates: [],
        drives: {
          accepted: [],
          duplicates: [queuedDrive(1).driveId],
          discarded: [queuedDrive(2).driveId],
          expired: [queuedDrive(3).driveId],
        },
      });
      await flushPendingTrackingPoints();
      expect(queuedDrives).toEqual([]);
    });

    test("a failed upload keeps Drives queued", async () => {
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      queuedDrives = [queuedDrive(9)];
      uploadGroup = async () => {
        throw new Error("Network request failed");
      };
      await expect(flushPendingTrackingPoints()).rejects.toThrow();
      expect(queuedDrives).toHaveLength(1);
    });

    test("a refused request with Drives retries the points alone, then drops Drives refused alone", async () => {
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      queuedDrives = [queuedDrive(4)];
      uploadGroup = async (input) => {
        if (input.drives) {
          throw Object.assign(new Error("Bad request"), { data: { code: "BAD_REQUEST" } });
        }
        return placeAnswer(input);
      };
      await flushPendingTrackingPoints();
      expect(deleted).toEqual([[1]]);
      expect(queuedDrives).toEqual([]);
    });

    test("Drives from an earlier device or the server would refuse are dropped, never sent", async () => {
      queuedDrives = [
        queuedDrive(5, "group-1", "device-0"),
        { ...queuedDrive(6), ciphertext: encodeBase64(new Uint8Array(1_000)) },
        queuedDrive(10),
      ];
      await flushPendingTrackingPoints();
      expect(deletedDrives[0]?.sort()).toEqual([5, 6]);
      expect(
        uploadCalls.flatMap((call) => call.drives ?? []).map(({ driveId }) => driveId),
      ).toEqual([queuedDrive(10).driveId]);
    });

    test("a phone with no registered device sends no place fields", async () => {
      registeredDevice = null;
      pendingCiphertexts = [createQueueItem({ clientPointId: "p1", groupId: "group-1", id: 1 })];
      queuedTransitions = [transition("00000000-0000-4000-8000-000000000001")];
      await flushPendingTrackingPoints();
      expect(uploadCalls[0]?.placeTransitions).toBeUndefined();
      expect(uploadCalls[0]?.placeAlertsCursor).toBeUndefined();
    });
  });

  test("uploads only the current server and account queue", async () => {
    pendingCiphertexts = [
      {
        ...createQueueItem({ clientPointId: "current", groupId: "group-1", id: 1 }),
        owner: JSON.stringify(["https://api.example.test", "user-1"]),
      },
      {
        ...createQueueItem({ clientPointId: "other-user", groupId: "group-1", id: 2 }),
        owner: JSON.stringify(["https://api.example.test", "user-2"]),
      },
      {
        ...createQueueItem({ clientPointId: "other-server", groupId: "group-1", id: 3 }),
        owner: JSON.stringify(["https://other.example.test", "user-1"]),
      },
    ];
    await flushPendingTrackingPoints();
    expect(requestedOwners).toEqual([JSON.stringify(["https://api.example.test", "user-1"])]);
    expect(deleted).toEqual([[1]]);
  });

  test("sends each point's recorded hour, and none for live rows or rows queued before it existed", async () => {
    const owner = JSON.stringify(["https://api.example.test", "user-1"]);
    pendingCiphertexts = [
      { capturedHour: 498_600, clientPointId: "point", id: 1, role: "POINT" as const },
      { capturedHour: 498_590, clientPointId: "stay", id: 2, role: "STAY" as const },
      { capturedHour: null, clientPointId: "live", id: 3, role: "LIVE" as const },
      { capturedHour: null, clientPointId: "old-point", id: 4, role: "POINT" as const },
    ].map((item) => ({ ...createQueueItem({ ...item, groupId: "group-1" }), owner }));
    await flushPendingTrackingPoints();
    expect(
      uploadCalls
        .flatMap(({ points }) => points)
        .map(({ capturedHour, clientPointId, role }) => [clientPointId, role, capturedHour]),
    ).toEqual([
      [pointId("point"), "POINT", 498_600],
      [pointId("stay"), "STAY", 498_590],
      [pointId("live"), "LIVE", undefined],
      [pointId("old-point"), "POINT", undefined],
    ]);
    expect(
      uploadCalls.flatMap(({ points }) => points).filter((point) => "capturedHour" in point),
    ).toHaveLength(2);
    expect(deleted.flat().sort()).toEqual([1, 2, 3, 4]);
  });

  test("sends only the newest queued copy of a stay and drops the older ones", async () => {
    const owner = JSON.stringify(["https://api.example.test", "user-1"]);
    pendingCiphertexts = [
      {
        ...createQueueItem({ clientPointId: "stay", groupId: "group-1", id: 1, role: "STAY" }),
        owner,
      },
      { ...createQueueItem({ clientPointId: "point", groupId: "group-1", id: 2 }), owner },
      {
        ...createQueueItem({ clientPointId: "stay", groupId: "group-1", id: 3, role: "STAY" }),
        owner,
      },
    ];
    await flushPendingTrackingPoints();
    expect(uploadCalls[0]?.points).toEqual([
      {
        ciphertext: queuedCiphertext,
        clientPointId: pointId("point"),
        epochId: "epoch-1",
        nonce: queuedNonce,
        role: "POINT",
        senderDeviceId: "device-1",
      },
      {
        ciphertext: queuedCiphertext,
        clientPointId: pointId("stay"),
        epochId: "epoch-1",
        nonce: queuedNonce,
        role: "STAY",
        senderDeviceId: "device-1",
      },
    ]);
    expect(markedInFlight).toEqual([[2, 3]]);
    expect(deleted).toEqual([[1], [2, 3]]);
  });

  test("drops an older stay or live copy that is waiting out its retry once a newer one is listed", async () => {
    const backingOff = { attemptCount: 3, lastAttemptAt: Date.now() };
    pendingCiphertexts = [
      {
        ...createQueueItem({ clientPointId: "stay", groupId: "group-1", id: 1, role: "STAY" }),
        ...backingOff,
      },
      {
        ...createQueueItem({ clientPointId: "live-1", groupId: "group-1", id: 2, role: "LIVE" }),
        ...backingOff,
      },
      {
        ...createQueueItem({
          clientPointId: "other-live",
          groupId: "group-2",
          id: 3,
          role: "LIVE",
        }),
        ...backingOff,
      },
      createQueueItem({ clientPointId: "stay", groupId: "group-1", id: 4, role: "STAY" }),
      createQueueItem({ clientPointId: "live-2", groupId: "group-1", id: 5, role: "LIVE" }),
    ];

    await flushPendingTrackingPoints();

    expect(deleted[0]).toEqual([1, 2]);
    expect(markedInFlight).toEqual([[4, 5]]);
    expect(requeued).toEqual([]);
  });

  test("deletes queued points the server would refuse instead of uploading them", async () => {
    pendingCiphertexts = [
      {
        ...createQueueItem({ clientPointId: "old-format", groupId: "group-1", id: 1 }),
        clientPointId: encodeBase64(new Uint8Array(32).fill(3)),
        ciphertext: encodeBase64(new TextEncoder().encode(JSON.stringify({ v: 1, lat: 51.5 }))),
      },
      {
        ...createQueueItem({ clientPointId: "old-id", groupId: "group-1", id: 2 }),
        clientPointId: encodeBase64(new Uint8Array(32).fill(4)),
      },
      createQueueItem({ clientPointId: "current", groupId: "group-1", id: 3 }),
    ];

    await flushPendingTrackingPoints();

    expect(deleted).toEqual([[1, 2], [3]]);
    expect(uploadCalls.flatMap(({ points }) => points)).toEqual([
      expect.objectContaining({ clientPointId: pointId("current") }),
    ]);
  });

  test("holds pre-pause points while a local pause hasn't reached the server", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    const pauseKey = `locationSharing.pending.${JSON.stringify(["https://api.example.test", "user-1", "device"])}`;
    const input = {
      scope: "device",
      deviceId: "device-1",
      expectedUserId: "user-1",
      paused: true,
      durationMinutes: null,
    };
    storageValues.set(pauseKey, JSON.stringify({ requestId: "sharing-1", input }));
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "before-pause", groupId: "group-1", id: 1 }),
    ];
    await flushPendingTrackingPoints();
    expect(markedInFlight).toEqual([]);
    expect(uploadCalls).toEqual([]);
    storageValues.delete(pauseKey);
    await flushPendingTrackingPoints();
    expect(deleted).toEqual([[1]]);
  });

  test("starting capture applies the server's sharing preference to the capture runtime", async () => {
    await reconcileTrackingKeys({ startCapture: true });
    expect(startCaptureCalls).toBe(1);
    expect(sharingStates).toEqual([
      {
        owner: JSON.stringify(["https://api.example.test", "user-1"]),
        deviceId: "device-1",
        prefix: "",
        paused: false,
      },
    ]);
  });

  test("an unreachable sharing preference doesn't stop capture from starting", async () => {
    locationSharingError = new Error("offline");
    await reconcileTrackingKeys({ startCapture: true });
    expect(startCaptureCalls).toBe(1);
  });

  test("only assigns legacy points after confirmation for the same account", async () => {
    unassignedCount = 2;
    expect(await getUnassignedTrackingPoints()).toEqual({
      count: 2,
      deviceIds: ["device-1"],
      server: "https://api.example.test",
      userId: "user-1",
    });
    currentUserId = "user-2";
    await expect(
      recoverUnassignedTrackingPoints({ deviceIds: ["device-1"], userId: "user-1" }),
    ).rejects.toThrow("The tracking account has changed.");
    expect(assignments).toEqual([]);
    currentUserId = "user-1";
    await recoverUnassignedTrackingPoints({ deviceIds: ["device-1"], userId: "user-1" });
    expect(assignments).toEqual([
      { deviceId: "device-1", owner: JSON.stringify(["https://api.example.test", "user-1"]) },
    ]);
  });

  test("stops capture and retries delayed points before sign out, retaining failures", async () => {
    pendingCiphertexts = [
      {
        ...createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
        attemptCount: 3,
        lastAttemptAt: Date.now(),
      },
    ];
    uploadGroup = async () => {
      throw new Error("offline");
    };
    await expect(prepareTrackingSignOut()).rejects.toThrow("Tracking upload failed");
    expect(stopCaptureCalls).toBe(1);
    expect(uploadCalls).toHaveLength(1);
    expect(deleted).toEqual([]);
    expect(requeued).toHaveLength(1);
    await flushPendingTrackingPoints();
    expect(uploadCalls).toHaveLength(1);
    resumeTracking();
    await expect(flushPendingTrackingPoints(true)).rejects.toThrow("Tracking upload failed");
    expect(uploadCalls).toHaveLength(2);
  });

  test("the sign-out upload still sends this phone's device id and keeps it for the rest of sign-out", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    const deviceIdsAtUpload: Array<string | undefined> = [];
    uploadGroup = async ({ points }) => {
      deviceIdsAtUpload.push(registeredDevice?.deviceId);
      return {
        accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
        duplicates: [],
      };
    };

    await prepareTrackingSignOut();

    expect(stopCaptureCalls).toBe(1);
    expect(deviceIdsAtUpload).toEqual(["device-1"]);
    expect(registeredDevice?.deviceId).toBe("device-1");
  });

  test("sign out times out and retains a late upload response", async () => {
    jest.useFakeTimers();
    try {
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      let resolveUpload: (result: { accepted: string[]; duplicates: string[] }) => void = () => {};
      uploadGroup = () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        });
      const signOut = prepareTrackingSignOut();
      for (let index = 0; index < 200 && uploadCalls.length === 0; index++) await Promise.resolve();
      expect(uploadCalls).toHaveLength(1);
      jest.advanceTimersByTime(10_000);
      await signOut;
      currentUserId = "user-2";
      resolveUpload({ accepted: ["point-1"], duplicates: [] });
      for (let index = 0; index < 20 && requeued.length === 0; index++) await Promise.resolve();
      expect(deleted).toEqual([]);
      expect(requeued).toEqual([{ ids: [1], error: "UPLOAD_CANCELLED" }]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("sign out times out an existing flush without starting a later session upload", async () => {
    jest.useFakeTimers();
    try {
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      let resolveUpload: (result: { accepted: string[]; duplicates: string[] }) => void = () => {};
      uploadGroup = () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        });
      const existingFlush = flushPendingTrackingPoints();
      for (let index = 0; index < 200 && uploadCalls.length === 0; index++) await Promise.resolve();
      const signOut = prepareTrackingSignOut();
      jest.advanceTimersByTime(10_000);
      await signOut;
      currentUserId = "user-2";
      resolveUpload({ accepted: ["point-1"], duplicates: [] });
      await expect(existingFlush).resolves.toBeUndefined();
      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(uploadCalls).toHaveLength(1);
      expect(deleted).toEqual([]);
      expect(requeued).toEqual([{ ids: [1], error: "UPLOAD_CANCELLED" }]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a never-settling old flush does not block the next login", async () => {
    jest.useFakeTimers();
    try {
      pendingCiphertexts = [createQueueItem({ clientPointId: "old", groupId: "group-1", id: 1 })];
      uploadGroup = () => new Promise(() => {});
      const oldFlush = flushPendingTrackingPoints();
      for (let index = 0; index < 200 && uploadCalls.length === 0; index++) await Promise.resolve();
      expect(uploadCalls).toHaveLength(1);
      const signOut = prepareTrackingSignOut();
      await expect(oldFlush).resolves.toBeUndefined();
      jest.advanceTimersByTime(10_000);
      await signOut;
      currentUserId = "user-2";
      pendingCiphertexts = [];
      resumeTracking();
      await expect(flushPendingTrackingPoints(true)).resolves.toBeUndefined();
      expect(requestedOwners.at(-1)).toBe(JSON.stringify(["https://api.example.test", "user-2"]));
    } finally {
      jest.useRealTimers();
    }
  });

  test("logout detaches stalled reconciliation and prevents its late work from touching the next account", async () => {
    let release = () => {};
    let started = false;
    registrationWait = new Promise((resolve) => {
      release = resolve;
    });
    onRegistration = () => {
      started = true;
    };
    const previous = reconcileTrackingKeys({ startCapture: true });
    for (let index = 0; index < 200 && !started; index++) await Promise.resolve();
    expect(started).toBe(true);
    await prepareTrackingSignOut();
    await expect(previous).resolves.toBe(false);
    currentUserId = "user-2";
    registrationWait = null;
    onRegistration = null;
    resumeTracking();
    await reconcileTrackingKeys({ startCapture: true });
    const calls = provisionCalls.length;
    const stops = stopCaptureCalls;
    const ownerQueries = ownerContextCalls;
    release();
    for (let index = 0; index < 100; index++) await Promise.resolve();
    expect(provisionCalls).toHaveLength(calls);
    expect(stopCaptureCalls).toBe(stops);
    expect(ownerContextCalls).toBe(ownerQueries);
  });

  test("a late old flush cannot clear a newer session's active flush", async () => {
    jest.useFakeTimers();
    try {
      pendingCiphertexts = [createQueueItem({ clientPointId: "old", groupId: "group-1", id: 1 })];
      let resolveOld: (result: { accepted: string[]; duplicates: string[] }) => void = () => {};
      uploadGroup = () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        });
      const oldFlush = flushPendingTrackingPoints();
      for (let index = 0; index < 200 && uploadCalls.length === 0; index++) await Promise.resolve();
      const signOut = prepareTrackingSignOut();
      jest.advanceTimersByTime(10_000);
      await signOut;
      currentUserId = "user-2";
      pendingCiphertexts = [];
      let releaseOwner = () => {};
      ownerQueryGate = new Promise((resolve) => {
        releaseOwner = resolve;
      });
      resumeTracking();
      const newFlush = flushPendingTrackingPoints();
      resolveOld({ accepted: ["old"], duplicates: [] });
      await expect(oldFlush).resolves.toBeUndefined();
      for (let index = 0; index < 100 && requeued.length === 0; index++) await Promise.resolve();
      expect(flushPendingTrackingPoints()).toBe(newFlush);
      releaseOwner();
      await expect(newFlush).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a late unauthorized split cannot revoke the next account", async () => {
    jest.useFakeTimers();
    try {
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "invalid", groupId: "group-1", id: 1 }),
        createQueueItem({ clientPointId: "late", groupId: "group-1", id: 2 }),
      ];
      let rejectLate: (error: Error) => void = () => {};
      uploadGroup = async ({ points }) => {
        if (
          points.length > 1 ||
          (points[0] as { clientPointId: string }).clientPointId === pointId("invalid")
        ) {
          throw Object.assign(new Error("invalid"), { data: { code: "BAD_REQUEST" } });
        }
        return new Promise((_resolve, reject) => {
          rejectLate = reject;
        });
      };
      const oldFlush = flushPendingTrackingPoints();
      for (let index = 0; index < 200 && uploadCalls.length < 3; index++) await Promise.resolve();
      expect(uploadCalls).toHaveLength(3);
      const signOut = prepareTrackingSignOut();
      jest.advanceTimersByTime(10_000);
      await signOut;
      currentUserId = "user-2";
      pendingCiphertexts = [];
      resumeTracking();
      await reconcileTrackingKeys({ startCapture: true });
      const revocations = revokedGroups.length;
      const stops = stopCaptureCalls;
      rejectLate(Object.assign(new Error("expired"), { data: { code: "UNAUTHORIZED" } }));
      await expect(oldFlush).resolves.toBeUndefined();
      for (let index = 0; index < 100 && !requeued.some(({ ids }) => ids.includes(2)); index++)
        await Promise.resolve();
      expect(revokedGroups).toHaveLength(revocations);
      expect(stopCaptureCalls).toBe(stops);
      expect(requeued).toContainEqual({ ids: [2], error: "UPLOAD_CANCELLED" });
    } finally {
      jest.useRealTimers();
    }
  });

  test("a late owner lookup cannot upload under the next account", async () => {
    jest.useFakeTimers();
    try {
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      let releaseOwner = () => {};
      ownerQueryGate = new Promise((resolve) => {
        releaseOwner = resolve;
      });
      const signOut = prepareTrackingSignOut();
      for (let index = 0; index < 100; index++) await Promise.resolve();
      jest.advanceTimersByTime(10_000);
      await signOut;
      currentUserId = "user-2";
      releaseOwner();
      for (let index = 0; index < 100; index++) await Promise.resolve();
      expect(requestedOwners).toEqual([]);
      expect(uploadCalls).toEqual([]);
      expect(deleted).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("continues past a failed batch when flushing at sign out", async () => {
    pendingCiphertexts = Array.from({ length: 101 }, (_, index) =>
      createQueueItem({
        clientPointId: `point-${index}`,
        groupId: index === 0 ? "bad" : "good",
        id: index + 1,
      }),
    );
    uploadGroup = async ({ groupId, points }) => {
      if (groupId === "bad") throw new Error("offline");
      return {
        accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
        duplicates: [],
      };
    };
    await expect(prepareTrackingSignOut()).rejects.toThrow("Tracking upload failed");
    expect(deleted.flat()).toHaveLength(100);
    expect(requeued).toHaveLength(1);
  });

  test("replaces native keys with every current group epoch before starting capture", async () => {
    await reconcileTrackingKeys({ startCapture: true });

    expect(revokedGroups).toEqual([]);
    expect(provisionCalls).toEqual([
      [
        {
          groupId: "group-1",
          epochId: "epoch-1",
          epochKeyBase64: encodeBase64(epochKey1.expose()),
          senderDeviceId: "device-1",
          kind: "trackingPoint",
        },
        {
          groupId: "group-2",
          epochId: "epoch-2",
          epochKeyBase64: encodeBase64(epochKey2.expose()),
          senderDeviceId: "device-1",
          kind: "trackingPoint",
        },
      ],
    ]);
    expect(startCaptureCalls).toBe(1);
  });

  test("stops detecting places in a group this phone has left", async () => {
    placeGroups = ["group-1", "group-left"];
    await reconcileTrackingKeys({ startCapture: true });

    expect(revokedGroups).toEqual([["group-left"]]);
  });

  test("provisions a group's current epoch from a history wrap when there's no device wrap", async () => {
    historyOnlyGroup = "group-1";

    await reconcileTrackingKeys({ startCapture: true });

    expect(provisionCalls).toEqual([
      [
        {
          groupId: "group-1",
          epochId: "epoch-1",
          epochKeyBase64: encodeBase64(epochKey1.expose()),
          senderDeviceId: "device-1",
          kind: "trackingPoint",
        },
        {
          groupId: "group-2",
          epochId: "epoch-2",
          epochKeyBase64: encodeBase64(epochKey2.expose()),
          senderDeviceId: "device-1",
          kind: "trackingPoint",
        },
      ],
    ]);
  });

  test("backfills an epoch created before the history key existed on the next reconcile", async () => {
    missingHistoryWraps.set("group-1", ["epoch-1"]);
    await reconcileTrackingKeys({ startCapture: true });

    expect(historyWrapUploads).toHaveLength(1);
    const [upload] = historyWrapUploads;
    expect(upload?.groupId).toBe("group-1");
    const [wrap] = upload?.wraps ?? [];
    if (!wrap) throw new Error("Missing history wrap");
    expect(
      encodeBase64(
        unwrapHistoryEpochKey({
          epochId: "epoch-1",
          historyKeyVersion: 1,
          historyPrivateKey: historyKeyPair.privateKey,
          userId: "user-1",
          wrappedEpochKey: wrap,
        }).expose(),
      ),
    ).toBe(encodeBase64(epochKey1.expose()));

    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
  });

  test("revoking keys offline doesn't leave a fresh key check that keeps capture off", async () => {
    await reconcileTrackingKeys({ startCapture: true, force: true });
    expect(provisionedKeys).toHaveLength(2);
    const starts = startCaptureCalls;

    failMembershipList = true;
    await expect(reconcileTrackingKeys({ startCapture: false, force: true })).rejects.toThrow(
      "Network request failed",
    );
    expect(provisionedKeys).toHaveLength(0);

    failMembershipList = false;
    await reconcileTrackingKeys({ startCapture: true });

    expect(provisionedKeys).toHaveLength(2);
    expect(startCaptureCalls).toBe(starts + 1);
  });

  test("opening the app offline after the process died restarts capture from the keys on the phone", async () => {
    await reconcileTrackingKeys({ startCapture: true, force: true });
    expect(provisionedKeys).toHaveLength(2);
    expect(startCaptureCalls).toBe(1);

    captureRunning = false;
    failMembershipList = true;
    failRegistration = true;

    await expect(reconcileTrackingKeys({ startCapture: true, force: true })).rejects.toThrow();
    expect(startCaptureCalls).toBe(2);
    expect(provisionedKeys).toHaveLength(2);
  });

  test("an offline start doesn't capture with keys queued for another account", async () => {
    await reconcileTrackingKeys({ startCapture: true, force: true });
    captureRunning = false;
    nativeQueueOwner = JSON.stringify([
      JSON.stringify(["https://api.example.test", "user-2"]),
      "device-9",
    ]);
    failMembershipList = true;
    failRegistration = true;

    await expect(reconcileTrackingKeys({ startCapture: true, force: true })).rejects.toThrow();
    expect(startCaptureCalls).toBe(1);
  });

  test("checks and sweeps for backfill at most once every ten minutes per user", async () => {
    jest.useFakeTimers();
    try {
      await reconcileTrackingKeys({ startCapture: true });
      await reconcileTrackingKeys({ startCapture: false, force: true });

      expect(recoveryStatusCalls).toBe(1);
      expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);

      jest.advanceTimersByTime(10 * 60 * 1000 - 1);
      await reconcileTrackingKeys({ startCapture: false, force: true });

      expect(recoveryStatusCalls).toBe(1);
      expect(backfillQueries).toHaveLength(2);

      jest.advanceTimersByTime(1);
      await reconcileTrackingKeys({ startCapture: false, force: true });

      expect(recoveryStatusCalls).toBe(2);
      expect(backfillQueries).toHaveLength(4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("doesn't recheck a phone that lacks the current history key until the interval passes", async () => {
    recoveryStatus = {
      currentHistoryKey: { publicKey: historyKeyPair.publicKey, version: 2 },
      recoveryKey: {},
    };
    await reconcileTrackingKeys({ startCapture: true });
    await reconcileTrackingKeys({ startCapture: true });

    expect(recoveryStatusCalls).toBe(1);
  });

  test("a reconcile before this phone holds the history key doesn't delay the backfill after a restore", async () => {
    recoveryStatus = {
      currentHistoryKey: { publicKey: historyKeyPair.publicKey, version: 2 },
      recoveryKey: {},
    };
    await reconcileTrackingKeys({ startCapture: false });
    expect(backfillQueries).toEqual([]);

    storedHistoryKeyVersions.add(2);
    await reconcileTrackingKeys({ startCapture: false, force: true });

    expect(recoveryStatusCalls).toBe(2);
    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
  });

  test("a restore between reconciles with capture running backfills straight away", async () => {
    recoveryStatus = {
      currentHistoryKey: { publicKey: historyKeyPair.publicKey, version: 2 },
      recoveryKey: {},
    };
    await reconcileTrackingKeys({ startCapture: true });
    expect(backfillQueries).toEqual([]);

    storedHistoryKeyVersions.add(2);
    await reconcileTrackingKeys({ startCapture: true, force: true });

    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
  });

  test("a failed backfill leaves the next reconcile free to retry", async () => {
    backfillErrors.set("group-1", new Error("Backfill unavailable"));
    await reconcileTrackingKeys({ startCapture: true });
    backfillErrors.clear();
    backfillQueries.length = 0;
    await reconcileTrackingKeys({ startCapture: false });

    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
  });

  test("an unreachable recovery status leaves the next reconcile free to retry", async () => {
    recoveryStatusError = new Error("offline");
    await reconcileTrackingKeys({ startCapture: true });
    recoveryStatusError = null;
    await reconcileTrackingKeys({ startCapture: true });

    expect(recoveryStatusCalls).toBe(2);
    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
  });

  test("an account with no history key gets v1 from this phone, which backfills and re-seals", async () => {
    recoveryStatus = { currentHistoryKey: null, recoveryKey: null };
    storedHistoryKeyVersions.clear();
    missingHistoryWraps.set("group-1", ["epoch-1"]);

    await reconcileTrackingKeys({ startCapture: true });

    expect(createHistoryKeyCalls).toBe(1);
    expect(startCaptureCalls).toBe(1);
    const wrap = historyWrapUploads[0]?.wraps[0];
    if (!wrap) throw new Error("Missing history wrap");
    expect(
      encodeBase64(
        unwrapHistoryEpochKey({
          epochId: "epoch-1",
          historyKeyVersion: 1,
          historyPrivateKey: historyKeyPair.privateKey,
          userId: "user-1",
          wrappedEpochKey: wrap,
        }).expose(),
      ),
    ).toBe(encodeBase64(epochKey1.expose()));
    expect(resealedUsers).toEqual(["user-1"]);
  });

  test("a Pending device doesn't capture, rotate, backfill or create a history key", async () => {
    recoveryStatus = { currentHistoryKey: null, recoveryKey: null };
    storedHistoryKeyVersions.clear();
    thisDeviceActive = false;

    await reconcileTrackingKeys({ startCapture: true });
    await reconcileTrackingKeys({ startCapture: false, force: true });

    expect(startCaptureCalls).toBe(0);
    expect(provisionCalls).toEqual([]);
    expect(rotationChecks).toEqual([]);
    expect(createHistoryKeyCalls).toBe(0);
    expect(backfillQueries).toEqual([]);
  });

  test("without capture, a phone with no history key on the account still creates it", async () => {
    recoveryStatus = { currentHistoryKey: null, recoveryKey: null };
    storedHistoryKeyVersions.clear();

    await reconcileTrackingKeys({ startCapture: false });

    expect(createHistoryKeyCalls).toBe(1);
    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
    expect(resealedUsers).toEqual(["user-1"]);
  });

  test("a phone that loses the race to create the history key keeps sharing without it", async () => {
    recoveryStatus = { currentHistoryKey: null, recoveryKey: null };
    storedHistoryKeyVersions.clear();
    createHistoryKeyResult = false;

    await reconcileTrackingKeys({ startCapture: true });
    expect(startCaptureCalls).toBe(1);
    await reconcileTrackingKeys({ startCapture: true, force: true });

    expect(createHistoryKeyCalls).toBe(1);
    expect(backfillQueries).toEqual([]);
    expect(resealedUsers).toEqual([]);
  });

  test("a failed history key create keeps sharing and is retried on the next reconcile", async () => {
    recoveryStatus = { currentHistoryKey: null, recoveryKey: null };
    storedHistoryKeyVersions.clear();
    createHistoryKeyResult = new Error("offline");

    await reconcileTrackingKeys({ startCapture: true });
    expect(startCaptureCalls).toBe(1);
    expect(backfillQueries).toEqual([]);

    createHistoryKeyResult = true;
    await reconcileTrackingKeys({ startCapture: true });

    expect(createHistoryKeyCalls).toBe(2);
    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
  });

  test("skips every backfill call when this phone doesn't hold the current history key", async () => {
    recoveryStatus = {
      currentHistoryKey: { publicKey: historyKeyPair.publicKey, version: 2 },
      recoveryKey: {},
    };
    await reconcileTrackingKeys({ startCapture: true });
    await reconcileTrackingKeys({ startCapture: false });

    expect(backfillQueries).toEqual([]);
  });

  test("skips backfill when the stored key doesn't match the server's public key", async () => {
    recoveryStatus = {
      currentHistoryKey: { publicKey: createHistoryKeyPair().publicKey, version: 1 },
      recoveryKey: {},
    };
    await reconcileTrackingKeys({ startCapture: true });

    expect(backfillQueries).toEqual([]);
  });

  test("backfills every group when this phone holds the current history key", async () => {
    await reconcileTrackingKeys({ startCapture: true });

    expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);
  });

  test("keeps sharing without backfilling when the recovery status can't be loaded", async () => {
    recoveryStatusError = new Error("offline");
    await reconcileTrackingKeys({ startCapture: true });

    expect(startCaptureCalls).toBe(1);
    expect(backfillQueries).toEqual([]);
  });

  test("stops capture when the recovery status reports an unauthorized session", async () => {
    captureRunning = true;
    recoveryStatusError = Object.assign(new Error("Session revoked"), {
      data: { code: "UNAUTHORIZED" },
    });
    await syncBackgroundTracking();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(revokedGroups).toHaveLength(1);
    expect(captureRunning).toBe(false);
    expect(sessionChecks).toBeGreaterThan(0);
  });

  test("backfills when capture is off", async () => {
    missingHistoryWraps.set("group-2", ["epoch-2"]);
    await reconcileTrackingKeys({ startCapture: false });

    expect(historyWrapUploads.map(({ groupId }) => groupId)).toEqual(["group-2"]);
    expect(provisionCalls).toEqual([]);
  });

  test("keeps sharing every group when backfill fails for one", async () => {
    backfillErrors.set("group-1", new Error("Backfill unavailable"));
    missingHistoryWraps.set("group-2", ["epoch-2"]);
    await reconcileTrackingKeys({ startCapture: true });

    expect(provisionedKeys.map(({ groupId }) => groupId).sort()).toEqual(["group-1", "group-2"]);
    expect(startCaptureCalls).toBe(1);
    expect(historyWrapUploads.map(({ groupId }) => groupId)).toEqual(["group-2"]);
  });

  test("revokes keys and stops capture when backfill reports an unauthorized session", async () => {
    captureRunning = true;
    backfillErrors.set(
      "group-1",
      Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } }),
    );
    await syncBackgroundTracking();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provisionCalls).toHaveLength(1);
    expect(revokedGroups).toHaveLength(1);
    expect(captureRunning).toBe(false);
  });

  test("provisions keys and starts capture before backfilling", async () => {
    missingHistoryWraps.set("group-1", ["epoch-1"]);
    await reconcileTrackingKeys({ startCapture: true });

    expect(captureStateSeenByBackfill).toEqual([
      { provisions: 1, starts: 1 },
      { provisions: 1, starts: 1 },
    ]);
  });

  test("stops capture when backfill reports an unauthorized session while capture is off", async () => {
    backfillErrors.set(
      "group-2",
      Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } }),
    );
    await reconcileTrackingKeys({ startCapture: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(revokedGroups).toHaveLength(2);
  });

  test("continues sharing with accessible groups when another group key cannot be decrypted", async () => {
    brokenGroupKey = true;

    await reconcileTrackingKeys({ startCapture: true });

    expect(provisionCalls).toHaveLength(1);
    expect(provisionCalls[0]).toEqual([
      {
        groupId: "group-2",
        epochId: "epoch-2",
        epochKeyBase64: encodeBase64(epochKey2.expose()),
        senderDeviceId: "device-1",
        kind: "trackingPoint",
      },
    ]);
    expect(startCaptureCalls).toBe(1);
  });

  test("does not expose or replace keys when native metadata is already current", async () => {
    brokenGroupKey = true;
    provisionedKeys.push(
      {
        groupId: "group-1",
        epochId: "epoch-1",
        senderDeviceId: "device-1",
        kind: "trackingPoint",
      },
      {
        groupId: "group-2",
        epochId: "epoch-2",
        senderDeviceId: "device-1",
        kind: "trackingPoint",
      },
    );

    await reconcileTrackingKeys({ startCapture: true });

    expect(revokedGroups).toEqual([]);
    expect(provisionCalls).toEqual([]);
    expect(startCaptureCalls).toBe(1);
  });

  test("does not restart an active capture service during foreground reconciliation", async () => {
    captureRunning = true;

    await reconcileTrackingKeys({ startCapture: true });

    expect(startCaptureCalls).toBe(0);
  });

  test("requests a fresh location after installing a new epoch for an existing group", async () => {
    captureRunning = true;
    provisionedKeys.push({
      groupId: "group-1",
      epochId: "previous-epoch",
      senderDeviceId: "device-1",
      kind: "trackingPoint",
    });

    await reconcileTrackingKeys({ startCapture: true });

    expect(provisionCalls).toHaveLength(1);
    expect(refreshCaptureCalls).toBe(1);
    expect(stopCaptureCalls).toBe(0);
    expect(startCaptureCalls).toBe(0);
  });

  test("retries a failed location refresh even after the new keys are installed", async () => {
    captureRunning = true;
    failRefreshCapture = true;
    provisionedKeys.push({
      groupId: "group-1",
      epochId: "old",
      senderDeviceId: "device-1",
      kind: "trackingPoint",
    });

    await expect(reconcileTrackingKeys({ startCapture: true })).rejects.toThrow("refresh failed");
    provisionedKeys.splice(
      0,
      provisionedKeys.length,
      { groupId: "group-1", epochId: "epoch-1", senderDeviceId: "device-1", kind: "trackingPoint" },
      { groupId: "group-2", epochId: "epoch-2", senderDeviceId: "device-1", kind: "trackingPoint" },
    );
    failRefreshCapture = false;
    await reconcileTrackingKeys({ startCapture: true });
    await reconcileTrackingKeys({ startCapture: true });

    expect(refreshCaptureCalls).toBe(2);
  });

  test("stops capture without waiting for the server when sharing permission is removed", async () => {
    captureRunning = true;
    failRegistration = true;

    await reconcileTrackingKeys({ startCapture: false });
    expect(stopCaptureCalls).toBe(1);
    expect(revokedGroups).toEqual([undefined]);
  });

  test("reconciles and refreshes a running background capture before uploading", async () => {
    captureRunning = true;
    provisionedKeys.push({
      groupId: "group-1",
      epochId: "old",
      senderDeviceId: "device-1",
      kind: "trackingPoint",
    });
    pendingCiphertexts = [createQueueItem({ id: 1, clientPointId: "point-1", groupId: "group-1" })];
    await syncBackgroundTracking();
    expect(refreshCaptureCalls).toBe(1);
    expect(uploadCalls).toHaveLength(1);
  });

  test("keeps capture running when rotation checks fail temporarily", async () => {
    captureRunning = true;
    failRotation = true;
    await syncBackgroundTracking();
    expect(stopCaptureCalls).toBe(0);
    expect(revokedGroups).toEqual([]);
    failRotation = false;
    await syncBackgroundTracking();
    expect(provisionCalls).toHaveLength(1);
  });

  test("keeps all groups capturing and retries a failed rotation on the next cycle", async () => {
    failedGroup = "group-1";
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys.map(({ groupId }) => groupId)).toEqual(["group-1", "group-2"]);
    expect(startCaptureCalls).toBe(1);
    expect(rotationChecks.filter((id) => id === "group-1")).toHaveLength(1);
    failedGroup = null;
    await reconcileTrackingKeys({ startCapture: true });
    expect(rotationChecks.filter((id) => id === "group-1")).toHaveLength(2);
    expect(stopCaptureCalls).toBe(0);
  });

  test("preserves an existing key for an unavailable group while updating healthy groups", async () => {
    captureRunning = true;
    failedLatestGroup = "group-1";
    provisionedKeys.push({
      groupId: "group-1",
      epochId: "old",
      senderDeviceId: "device-1",
      kind: "trackingPoint",
    });
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys).toEqual(
      expect.arrayContaining([
        { groupId: "group-1", epochId: "old", senderDeviceId: "device-1", kind: "trackingPoint" },
        expect.objectContaining({ groupId: "group-2", epochId: "epoch-2" }),
      ]),
    );
    expect(stopCaptureCalls).toBe(0);
    failedLatestGroup = null;
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "group-1", epochId: "epoch-1" }),
        expect.objectContaining({ groupId: "group-2", epochId: "epoch-2" }),
      ]),
    );
    expect(provisionedKeys.some(({ epochId }) => epochId === "old")).toBe(false);
  });

  test("retains an existing key after a wrapped-key request fails and replaces it after recovery", async () => {
    captureRunning = true;
    failedWrappedGroup = "group-1";
    provisionedKeys.push({
      groupId: "group-1",
      epochId: "old",
      senderDeviceId: "device-1",
      kind: "trackingPoint",
    });
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys.map(({ epochId }) => epochId).sort()).toEqual(["epoch-2", "old"]);
    failedWrappedGroup = null;
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys.map(({ epochId }) => epochId).sort()).toEqual(["epoch-1", "epoch-2"]);
    expect(stopCaptureCalls).toBe(0);
  });

  test("keeps the previous key when the new wrapped key is missing", async () => {
    captureRunning = true;
    missingWrappedGroup = "group-1";
    provisionedKeys.push({
      groupId: "group-1",
      epochId: "old",
      senderDeviceId: "device-1",
      kind: "trackingPoint",
    });
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys.map(({ epochId }) => epochId).sort()).toEqual(["epoch-2", "old"]);
    expect(stopCaptureCalls).toBe(0);
    missingWrappedGroup = null;
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys.map(({ epochId }) => epochId).sort()).toEqual(["epoch-1", "epoch-2"]);
  });

  test("the open app leaves routine uploads to running capture", async () => {
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    captureRunning = true;
    await flushForegroundTrackingPoints();
    expect(uploadCalls).toEqual([]);
    await flushForegroundTrackingPoints(true);
    expect(uploadCalls).toHaveLength(1);
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-2", groupId: "group-1", id: 2 })];
    captureRunning = false;
    await flushForegroundTrackingPoints();
    expect(uploadCalls).toHaveLength(2);
  });

  test("a background upload with fresh keys doesn't fetch the sharing state", async () => {
    captureRunning = true;
    await reconcileTrackingKeys({ startCapture: true });
    const callsAfterKeyCheck = locationSharingCalls;
    requests.length = 0;
    await syncBackgroundTracking();
    expect(locationSharingCalls).toBe(callsAfterKeyCheck);
    expect(requests).not.toContain("groupMembership.list");
  });

  test("the open app keeps checking for a remote resume while this phone is paused", async () => {
    captureRunning = true;
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    await reconcileTrackingKeys({ startCapture: true });
    const callsAfterKeyCheck = locationSharingCalls;
    storageValues.set(
      `locationSharing.localPause.${JSON.stringify(["https://api.example.test", "user-1", "device-1"])}`,
      "true",
    );
    requests.length = 0;
    await reconcileTrackingKeys({ startCapture: true });
    expect(locationSharingCalls).toBe(callsAfterKeyCheck + 1);
    expect(requests).toEqual([]);
  });

  test("a sharing alarm fetches the sharing state even when keys are fresh", async () => {
    captureRunning = true;
    await reconcileTrackingKeys({ startCapture: true });
    const callsAfterKeyCheck = locationSharingCalls;
    await syncBackgroundTracking("sharing");
    expect(locationSharingCalls).toBe(callsAfterKeyCheck + 1);
  });

  test("a parked sharing check only fetches the sharing state", async () => {
    captureRunning = true;
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    await syncBackgroundTracking("parked");
    expect(locationSharingCalls).toBe(1);
    expect(requests).toEqual([]);
    expect(accountSyncCalls).toHaveLength(1);
    expect(provisionCalls).toHaveLength(0);
  });

  test("a key check reuses provisioned keys whose epoch hasn't changed", async () => {
    captureRunning = true;
    await reconcileTrackingKeys({ startCapture: true });
    expect(requests.filter((request) => request === "groupEpoch.getEpochKeyWraps")).toHaveLength(2);
    requests.length = 0;
    await reconcileTrackingKeys({ startCapture: true, force: true });
    expect(requests).toContain("groupEpoch.getLatest");
    expect(requests).not.toContain("groupEpoch.getEpochKeyWraps");
    expect(provisionedKeys.map(({ epochId }) => epochId).sort()).toEqual(["epoch-1", "epoch-2"]);
  });

  test("an upload reporting a changed key state runs a key check", async () => {
    captureRunning = true;
    await reconcileTrackingKeys({ startCapture: true });
    let keyState = "state-1";
    uploadGroup = async ({ points, placeAlertsCursor }) => ({
      accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
      duplicates: [],
      ...(placeAlertsCursor === undefined ? {} : { keyState }),
    });
    const startedAt = Date.now();
    const clock = spyOn(Date, "now");
    try {
      clock.mockReturnValue(startedAt);
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      await syncBackgroundTracking();
      clock.mockReturnValue(startedAt + 60_000);
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-2", groupId: "group-1", id: 2 }),
      ];
      requests.length = 0;
      await syncBackgroundTracking();
      expect(requests).not.toContain("groupMembership.list");
      keyState = "state-2";
      clock.mockReturnValue(startedAt + 120_000);
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-3", groupId: "group-1", id: 3 }),
      ];
      requests.length = 0;
      await syncBackgroundTracking();
      expect(requests).toContain("groupMembership.list");
      expect(uploadCalls.filter((call) => call.placeAlertsCursor !== undefined)).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
  });

  test("key state carried by an upload with only place changes still triggers a key check", async () => {
    captureRunning = true;
    await reconcileTrackingKeys({ startCapture: true });
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    queuedTransitions = [
      {
        clientId: "00000000-0000-4000-8000-000000000001",
        senderDeviceId: "device-1",
        groupId: "group-1",
        placeId: "place-group-1",
        direction: "ARRIVE",
        occurredAt: 1_000,
      },
    ];
    uploadGroup = async ({ points, placeTransitions }) => ({
      accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
      duplicates: [],
      keyState: "state-changed",
      ...(placeTransitions
        ? {
            placeTransitions: {
              accepted: placeTransitions.map(({ clientId }) => clientId),
              duplicates: [],
              discarded: [],
            },
          }
        : {}),
    });
    storageValues.set("tracking.keyState", `${Date.now()} state-before`);
    requests.length = 0;
    await syncBackgroundTracking();
    expect(uploadCalls).toEqual([expect.objectContaining({ points: [] })]);
    expect(requests).toContain("groupMembership.list");
  });

  test("does not start a stopped capture in the background", async () => {
    captureRunning = false;
    await syncBackgroundTracking();
    expect(provisionCalls).toHaveLength(0);
    expect(startCaptureCalls).toBe(0);
  });

  test("does not restore keys or restart capture when sharing stops during background reconciliation", async () => {
    captureRunning = true;
    let release = () => {};
    registrationWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      onRegistration = resolve;
    });
    const sync = syncBackgroundTracking();
    await started;
    captureRunning = false;
    release();
    await sync;
    expect(provisionCalls).toHaveLength(0);
    expect(startCaptureCalls).toBe(0);
    expect(refreshCaptureCalls).toBe(0);
  });

  test("stops sharing immediately when a background reconciliation is in flight", async () => {
    captureRunning = true;
    let release = () => {};
    registrationWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      onRegistration = resolve;
    });
    const background = syncBackgroundTracking();
    await started;
    const stopped = new Promise<void>((resolve) => {
      onStopCapture = resolve;
    });
    const stop = reconcileTrackingKeys({ startCapture: false });
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 100))]);
    expect(stopCaptureCalls).toBe(1);
    release();
    await Promise.all([background, stop]);
    expect(captureRunning).toBe(false);
    expect(provisionCalls).toHaveLength(0);
    expect(startCaptureCalls).toBe(0);
  });

  test("records the local send time for accepted points only", async () => {
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    const before = Date.now();
    await flushPendingTrackingPoints();
    expect(recordedUploads).toHaveLength(1);
    expect(recordedUploads[0]?.deviceId).toBe("device-1");
    expect(recordedUploads[0]?.groupId).toBe("group-1");
    expect(Date.parse(recordedUploads[0]?.timestamp ?? "")).toBeGreaterThanOrEqual(before);

    recordedUploads.length = 0;
    uploadGroup = async () => ({ accepted: [], duplicates: [pointId("point-1")] });
    await flushPendingTrackingPoints();
    expect(recordedUploads).toHaveLength(0);
  });

  test("drops points whose epoch the server has expired without requeueing them", async () => {
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "point-accepted", groupId: "group-1", id: 1 }),
      createQueueItem({ clientPointId: "point-expired", groupId: "group-1", id: 2 }),
    ];
    uploadGroup = async () => ({
      accepted: [pointId("point-accepted")],
      duplicates: [],
      expired: [pointId("point-expired")],
    });

    await flushPendingTrackingPoints();

    expect(uploadCalls).toHaveLength(1);
    expect(deleted.flat().sort()).toEqual([1, 2]);
    expect(requeued).toEqual([]);
    expect(recordedUploads).toHaveLength(1);
  });

  test("treats a response without expired points from an older server as before", async () => {
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "point-accepted", groupId: "group-1", id: 1 }),
      createQueueItem({ clientPointId: "point-missing", groupId: "group-1", id: 2 }),
    ];
    uploadGroup = async () => ({ accepted: [pointId("point-accepted")], duplicates: [] });

    await expect(flushPendingTrackingPoints()).rejects.toThrow("Tracking upload failed");

    expect(deleted.flat()).toEqual([1]);
    expect(requeued).toEqual([{ ids: [2], error: "UPLOAD_RESPONSE_INCOMPLETE" }]);
  });

  test("background upload does not throw when the device is offline", async () => {
    captureRunning = true;
    failRegistration = true;
    networkConnected = false;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw new Error("Network request failed");
    };

    await expect(syncBackgroundTracking()).resolves.toBeUndefined();
    expect(deleted).toEqual([]);
    expect(recordedUploads).toEqual([]);
    expect(stopCaptureCalls).toBe(0);
    expect(revokedGroups).toEqual([]);
  });

  test("background sync leaves the queue alone and notifies once while the app and server don't match", async () => {
    captureRunning = true;
    apiCompatibility = { problem: "appTooOld", serverVersion: null, notified: false };
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];

    await syncBackgroundTracking();
    await syncBackgroundTracking();

    expect(apiCompatibilityRefreshes).toBe(2);
    expect(uploadCalls).toEqual([]);
    expect(markedInFlight).toEqual([]);
    expect(deleted).toEqual([]);
    expect(provisionCalls).toHaveLength(0);
    expect(notices).toEqual([{ kind: "compatibility", problem: "appTooOld", selfHosted: false }]);
  });

  test.each(["appTooOld", "outOfSync"] as const)(
    "background sync parks capture while the problem is %s, so nothing is recorded for later",
    async (problem) => {
      captureRunning = true;
      apiCompatibility = { problem, serverVersion: null, notified: false };

      await syncBackgroundTracking();

      expect(stopCaptureCalls).toBe(1);
      expect(captureRunning).toBe(false);
      expect(uploadCalls).toEqual([]);
    },
  );

  test("background sync keeps capture running while the server is being updated", async () => {
    captureRunning = true;
    apiCompatibility = { problem: "serverTooOld", serverVersion: "0.1.0", notified: false };

    await syncBackgroundTracking();

    expect(stopCaptureCalls).toBe(0);
    expect(captureRunning).toBe(true);
  });

  test("starting capture does nothing while the app is too old, and works once it's updated", async () => {
    apiCompatibility = { problem: "appTooOld", serverVersion: null, notified: false };
    await reconcileTrackingKeys({ startCapture: true, force: true });
    expect(startCaptureCalls).toBe(0);
    expect(captureRunning).toBe(false);

    apiCompatibility = null;
    await reconcileTrackingKeys({ startCapture: true, force: true });
    expect(startCaptureCalls).toBeGreaterThan(0);
  });

  test("background sync uploads again once a fresh check shows the server was updated", async () => {
    captureRunning = true;
    apiCompatibility = { problem: "serverTooOld", serverVersion: "0.1.0", notified: true };
    apiCompatibilityRefreshClears = true;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];

    await syncBackgroundTracking();

    expect(uploadCalls).toHaveLength(1);
    expect(deleted).toEqual([[1]]);
    expect(notices).toEqual([]);
    expect(dismissedNotices).toEqual(["compatibility"]);
  });

  test("background sync tries the notice again when Android didn't show it", async () => {
    captureRunning = true;
    apiCompatibility = { problem: "serverTooOld", serverVersion: "0.1.0", notified: false };
    noticeAllowed = false;

    await syncBackgroundTracking();
    expect(apiCompatibility.notified).toBe(false);

    noticeAllowed = true;
    await syncBackgroundTracking();
    expect(apiCompatibility.notified).toBe(true);
    expect(notices).toEqual([
      { kind: "compatibility", problem: "serverTooOld", selfHosted: false },
    ]);
  });

  test("an upload rejected for compatibility keeps its points and notifies without failing the task", async () => {
    captureRunning = true;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      apiCompatibility = { problem: "appTooOld", serverVersion: null, notified: false };
      throw new Error("Upgrade Required");
    };

    await expect(syncBackgroundTracking()).resolves.toBeUndefined();

    expect(deleted).toEqual([]);
    expect(requeued.map(({ ids }) => ids)).toEqual([[1]]);
    expect(notices).toEqual([{ kind: "compatibility", problem: "appTooOld", selfHosted: false }]);
  });

  test("foreground flushes skip uploading while the app and server don't match", async () => {
    apiCompatibility = { problem: "outOfSync", serverVersion: null, notified: false };
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];

    await flushPendingTrackingPoints(true);

    expect(markedInFlight).toEqual([]);
    expect(uploadCalls).toEqual([]);
  });

  test("stops background capture when registration reports a revoked session", async () => {
    captureRunning = true;
    registrationError = Object.assign(new Error("Session revoked"), {
      data: { code: "UNAUTHORIZED" },
    });
    await syncBackgroundTracking();
    expect(stopCaptureCalls).toBe(1);
    expect(revokedGroups).toEqual([undefined]);
    expect(captureRunning).toBe(false);
    expect(deviceKeyPair.privateKey.expose()).toBeDefined();
    expect(notices).toEqual([{ kind: "signedOut" }]);
  });

  test("a revoked session doesn't notify when this phone wasn't sharing", async () => {
    captureRunning = false;
    registrationError = Object.assign(new Error("Session revoked"), {
      data: { code: "UNAUTHORIZED" },
    });
    await syncBackgroundTracking();
    expect(notices).toEqual([]);
  });

  test("a revoked session in the background clears alerts about other people but keeps security alerts", async () => {
    eventNoticeClears = [];
    captureRunning = true;
    registrationError = Object.assign(new Error("Session revoked"), {
      data: { code: "UNAUTHORIZED" },
    });
    await syncBackgroundTracking();
    expect(eventNoticeClears).toEqual([{ keepSecurityAlerts: true }]);
  });

  test("a phone removed in the background clears security alerts too", async () => {
    eventNoticeClears = [];
    captureRunning = true;
    await revokeTrackingAccess({ notice: "deviceRemoved" });
    expect(eventNoticeClears).toEqual([{ keepSecurityAlerts: false }]);
  });

  test("stops capture and retains queued points when upload reports a revoked session", async () => {
    captureRunning = true;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } });
    };
    await expect(syncBackgroundTracking()).rejects.toThrow();
    expect(stopCaptureCalls).toBe(1);
    expect(revokedGroups).toEqual([undefined]);
    expect(deleted).toEqual([]);
    expect(requeued).toHaveLength(1);
    expect(notices).toEqual([{ kind: "signedOut" }]);
  });

  test("uploads name the account they were made for", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    uploadAccounts.length = 0;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];

    await syncBackgroundTracking();

    expect(uploadAccounts).toEqual(["user-1"]);
  });

  test("an upload refused because its account signed out is requeued as cancelled, not counted as a failure", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    captureRunning = true;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      registeredDevice = null;
      throw new Error("Signed out of the account this request was for.");
    };

    await expect(flushPendingTrackingPoints()).rejects.toThrow();

    expect(requeued).toEqual([{ ids: [1], error: "UPLOAD_CANCELLED" }]);
    expect(stopCaptureCalls).toBe(0);
    expect(notices).toEqual([]);
  });

  test("a revoked session reported after another account signed in leaves that account alone", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    captureRunning = true;
    eventNoticeClears = [];
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      registeredDevice = {
        deviceId: "device-2",
        privateKey: deviceKeyPair.privateKey,
        userId: "user-2",
      };
      throw Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } });
    };

    await expect(syncBackgroundTracking()).rejects.toThrow();

    expect(stopCaptureCalls).toBe(0);
    expect(revokedGroups).toEqual([]);
    expect(notices).toEqual([]);
    expect(eventNoticeClears).toEqual([]);
    expect(registeredDevice?.userId).toBe("user-2");
  });

  test("an upload refused because this phone was removed keeps the registration for the wipe", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    captureRunning = true;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw createDeviceRemovedError();
    };
    await expect(syncBackgroundTracking()).rejects.toThrow();
    expect(stopCaptureCalls).toBe(1);
    expect(registeredDevice?.deviceId).toBe("device-1");
    expect(notices).toEqual([{ kind: "deviceRemoved" }]);
  });

  test("a key check refused because this phone was removed keeps the registration for the wipe", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    captureRunning = true;
    rotationError = createDeviceRemovedError();
    await syncBackgroundTracking();
    expect(stopCaptureCalls).toBe(1);
    expect(registeredDevice?.deviceId).toBe("device-1");
  });

  test("stops capture when a group rotation check reports an unauthorized session", async () => {
    captureRunning = true;
    rotationError = Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } });
    await syncBackgroundTracking();
    expect(stopCaptureCalls).toBe(1);
    expect(revokedGroups).toEqual([undefined]);
    expect(provisionCalls).toEqual([]);
  });

  test("does not restore keys after an upload revokes an in-flight reconciliation", async () => {
    captureRunning = true;
    let release = () => {};
    registrationWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      onRegistration = resolve;
    });
    const reconciliation = reconcileTrackingKeys({ startCapture: true });
    await started;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw Object.assign(new Error("Session revoked"), { data: { code: "UNAUTHORIZED" } });
    };
    await expect(flushPendingTrackingPoints()).rejects.toThrow();
    release();
    await reconciliation;
    expect(stopCaptureCalls).toBe(1);
    expect(provisionCalls).toEqual([]);
    expect(startCaptureCalls).toBe(0);
  });

  test("background upload silently waits for a queued retry", async () => {
    pendingCiphertexts = [
      {
        ...createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
        attemptCount: 8,
        lastAttemptAt: Date.now(),
        lastError: "Network request failed",
      },
    ];
    await expect(syncBackgroundTracking()).resolves.toBeUndefined();
    expect(uploadCalls).toHaveLength(0);
  });

  test("background upload reports failures while connected", async () => {
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw new Error("Server unavailable");
    };
    await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");
    expect(requeued).toHaveLength(1);
  });

  test("flushes each group independently and requeues transient failures", async () => {
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      createQueueItem({ clientPointId: "point-2", groupId: "group-2", id: 2 }),
    ];
    uploadGroup = async ({ groupId, points }) => {
      if (groupId === "group-2") {
        throw Object.assign(new Error("Unavailable"), {
          data: {
            code: "INTERNAL_SERVER_ERROR",
          },
        });
      }
      return {
        accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
        duplicates: [],
      };
    };

    await expect(flushPendingTrackingPoints()).rejects.toThrow("Tracking upload failed");

    expect(markedInFlight).toEqual([[1], [2]]);
    expect(deleted).toEqual([[1]]);
    expect(requeued).toEqual([{ ids: [2], error: "INTERNAL_SERVER_ERROR: Unavailable" }]);
  });

  test("does not upload points evicted between listing and claiming them", async () => {
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "evicted", groupId: "group-1", id: 1 }),
      createQueueItem({ clientPointId: "kept", groupId: "group-1", id: 2 }),
    ];
    evictedBeforeClaim.add(1);

    await flushPendingTrackingPoints();

    expect(uploadCalls.flatMap(({ points }) => points)).toEqual([
      expect.objectContaining({ clientPointId: pointId("kept") }),
    ]);
    expect(deleted).toEqual([[2]]);
    expect(requeued).toEqual([]);
  });

  test("reports evicted history only for the signed-in account on this server", async () => {
    const owner = JSON.stringify(["https://api.example.test", "user-1"]);
    queueEvictions.set(owner, {
      pointCount: 3,
      oldestQueuedAt: 1_000,
      newestQueuedAt: 2_000,
      revision: 7,
    });
    queueEvictions.set(JSON.stringify(["https://api.example.test", "user-2"]), {
      pointCount: 1,
      oldestQueuedAt: 5_000,
      newestQueuedAt: 5_000,
      revision: 1,
    });

    expect(await getTrackingQueueEviction("user-1")).toEqual({
      owner,
      pointCount: 3,
      oldestQueuedAt: 1_000,
      newestQueuedAt: 2_000,
      revision: 7,
    });
    expect(await getTrackingQueueEviction("user-3")).toBeNull();
  });

  test("dismissing stale eviction history keeps newer evictions visible", async () => {
    const owner = JSON.stringify(["https://api.example.test", "user-1"]);
    queueEvictions.set(owner, {
      pointCount: 3,
      oldestQueuedAt: 1_000,
      newestQueuedAt: 3_000,
      revision: 8,
    });

    await dismissTrackingQueueEviction({ owner, revision: 7 });
    expect(await getTrackingQueueEviction("user-1")).toMatchObject({ revision: 8 });

    await dismissTrackingQueueEviction({ owner, revision: 8 });
    expect(await getTrackingQueueEviction("user-1")).toBeNull();
  });

  test("retains queued points while a group rotation is pending", async () => {
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw Object.assign(new Error("Group key rotation is pending."), {
        data: { code: "CONFLICT" },
      });
    };
    await expect(flushPendingTrackingPoints()).rejects.toThrow("Tracking upload failed");
    expect(deleted).toEqual([]);
    expect(requeued).toEqual([{ ids: [1], error: "CONFLICT: Group key rotation is pending." }]);
  });

  test("drops a single point the server rejects as a bad request", async () => {
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw Object.assign(new Error("Epoch does not belong to this group."), {
        data: {
          code: "BAD_REQUEST",
        },
      });
    };

    await flushPendingTrackingPoints();

    expect(deleted).toEqual([[1]]);
    expect(requeued).toEqual([]);
  });

  test("retains a single point rejected for a reason that may pass later", async () => {
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw Object.assign(new Error("Something went wrong. Please try again."), {
        data: { code: "INTERNAL_SERVER_ERROR" },
      });
    };

    await expect(flushPendingTrackingPoints()).rejects.toThrow("Tracking upload failed");

    expect(deleted).toEqual([]);
    expect(requeued.map(({ ids }) => ids)).toEqual([[1]]);
  });

  test("isolates a permanently invalid point without discarding valid points", async () => {
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "point-valid", groupId: "group-1", id: 1 }),
      createQueueItem({ clientPointId: "point-invalid", groupId: "group-1", id: 2 }),
    ];
    uploadGroup = async ({ points }) => {
      if (
        points.some(
          (point) =>
            (point as { clientPointId: string }).clientPointId === pointId("point-invalid"),
        )
      ) {
        throw Object.assign(new Error("Epoch does not belong to this group."), {
          data: {
            code: "BAD_REQUEST",
          },
        });
      }

      return {
        accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
        duplicates: [],
      };
    };

    await flushPendingTrackingPoints();

    expect(uploadCalls.map(({ points }) => points.length)).toEqual([2, 1, 1]);
    expect(
      uploadCalls.some(
        ({ points }) =>
          points.length === 1 &&
          (points[0] as { clientPointId: string }).clientPointId === pointId("point-valid"),
      ),
    ).toBe(true);
    expect(deleted.flat().sort()).toEqual([1, 2]);
    expect(requeued).toEqual([]);
  });

  test("isolates revoked sender devices from valid points in the same group", async () => {
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "point-valid", groupId: "group-1", id: 1 }),
      createQueueItem({
        clientPointId: "point-revoked",
        groupId: "group-1",
        id: 2,
        senderDeviceId: "device-revoked",
      }),
    ];
    uploadGroup = async ({ points }) => {
      if (
        points.some(
          (point) => (point as { senderDeviceId: string }).senderDeviceId === "device-revoked",
        )
      ) {
        throw Object.assign(new Error("The active device is not registered."), {
          data: {
            code: "FORBIDDEN",
          },
        });
      }

      return {
        accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
        duplicates: [],
      };
    };

    await expect(flushPendingTrackingPoints()).rejects.toThrow("Tracking upload failed");

    expect(uploadCalls.map(({ points }) => points.length)).toEqual([1, 1]);
    expect(
      uploadCalls.some(
        ({ points }) =>
          (points[0] as { clientPointId: string }).clientPointId === pointId("point-valid"),
      ),
    ).toBe(true);
    expect(deleted.flat()).toEqual([1]);
    expect(requeued).toEqual([
      { ids: [2], error: "FORBIDDEN: The active device is not registered." },
    ]);
  });

  test("drops points from another device of this phone that the server no longer knows", async () => {
    registeredDevice = {
      deviceId: "device-1",
      privateKey: deviceKeyPair.privateKey,
      userId: "user-1",
    };
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "point-valid", groupId: "group-1", id: 1 }),
      createQueueItem({
        clientPointId: "point-old",
        groupId: "group-1",
        id: 2,
        senderDeviceId: "device-old",
      }),
    ];
    uploadGroup = async ({ points }) => {
      if (
        points.some(
          (point) => (point as { senderDeviceId: string }).senderDeviceId === "device-old",
        )
      ) {
        throw Object.assign(new Error("Any message"), {
          data: { code: "FORBIDDEN", reason: "DEVICE_NOT_REGISTERED" },
        });
      }
      return {
        accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
        duplicates: [],
      };
    };

    await flushPendingTrackingPoints();

    expect(deleted.flat().sort()).toEqual([1, 2]);
    expect(requeued).toEqual([]);
  });

  test("revokes every native key and stops capture", async () => {
    await revokeTrackingAccess();

    expect(revokedGroups).toEqual([undefined]);
    expect(stopCaptureCalls).toBe(1);
  });

  test("a notice asked for during a revoke that's already running is shown once", async () => {
    captureRunning = true;

    await Promise.all([
      revokeTrackingAccess(),
      revokeTrackingAccess({ notice: "signedOut" }),
      revokeTrackingAccess({ notice: "signedOut" }),
    ]);

    expect(stopCaptureCalls).toBe(1);
    expect(notices).toEqual([{ kind: "signedOut" }]);
  });

  test("a concurrent revoke doesn't notify when this phone wasn't sharing", async () => {
    captureRunning = false;

    await Promise.all([revokeTrackingAccess(), revokeTrackingAccess({ notice: "deviceRemoved" })]);

    expect(notices).toEqual([]);
  });

  test("a revoke without a sign-out notice keeps alerts about other people", async () => {
    eventNoticeClears = [];
    captureRunning = true;
    await revokeTrackingAccess();
    expect(eventNoticeClears).toEqual([]);
  });

  test("a notice from one revoke isn't carried into the next", async () => {
    captureRunning = true;
    await revokeTrackingAccess({ notice: "signedOut" });
    captureRunning = true;
    await revokeTrackingAccess();

    expect(notices).toEqual([{ kind: "signedOut" }]);
  });

  test("stops capture when native key removal fails", async () => {
    failRevokeEpochKeys = true;

    await expect(revokeTrackingAccess()).rejects.toThrow("revoke failed");

    expect(stopCaptureCalls).toBe(1);
  });
  describe("request counts", () => {
    const keyCheckRequests = [
      "groupMembership.list",
      "groupEpoch.rotationContext",
      "groupEpoch.getLatest",
    ];
    const queueBothGroups = () => {
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
        createQueueItem({ clientPointId: "point-2", groupId: "group-2", id: 2 }),
      ];
    };
    const startTracking = async () => {
      captureRunning = true;
      await reconcileTrackingKeys({ startCapture: true, force: true });
      requests.length = 0;
    };

    test("a History key read that times out during the key check doesn't hold back uploads", async () => {
      recoveryStatus = {
        currentHistoryKey: { publicKey: historyKeyPair.publicKey, version: 2 },
        recoveryKey: {},
      };
      await startTracking();
      queueBothGroups();
      storageValues.delete("tracking.keyCheck");
      historyKeyReadError = new Error("Key storage is unavailable.");
      failedHistoryKeyReads = 0;

      await syncBackgroundTracking();

      expect(failedHistoryKeyReads).toBeGreaterThan(0);
      expect(requests.filter((request) => request === "groupTracking.uploadBatch")).toHaveLength(2);
      expect(deleted.flat().sort()).toEqual([1, 2]);
    });

    test("a background sync with nothing new sends only the uploads", async () => {
      await startTracking();
      queueBothGroups();

      await syncBackgroundTracking();

      expect(requests).toEqual(["groupTracking.uploadBatch", "groupTracking.uploadBatch"]);
    });

    test("a background sync with an empty queue sends nothing", async () => {
      await startTracking();

      await syncBackgroundTracking();
      await syncBackgroundTracking();

      expect(requests).toEqual([]);
    });

    test("registers the device once across many syncs", async () => {
      await reconcileTrackingKeys({ startCapture: true, force: true });
      captureRunning = true;
      for (let index = 0; index < 5; index++) {
        queueBothGroups();
        await syncBackgroundTracking();
      }
      await reconcileTrackingKeys({ startCapture: true, force: true });

      expect(requests.filter((request) => request === "auth.registerDeviceKey")).toHaveLength(1);
    });

    test("the key check runs again once four minutes have passed", async () => {
      jest.useFakeTimers();
      try {
        await startTracking();

        jest.advanceTimersByTime(4 * 60 * 1000 - 1);
        await syncBackgroundTracking();
        expect(requests).toEqual([]);

        jest.advanceTimersByTime(1);
        await syncBackgroundTracking();
        expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
        expect(requests).not.toContain("auth.registerDeviceKey");
      } finally {
        jest.useRealTimers();
      }
    });

    test("a forced key check confirms the account without registering again", async () => {
      await startTracking();

      await reconcileTrackingKeys({ startCapture: true, force: true });

      expect(requests).toContain("auth.deviceKeyContext");
      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
      expect(requests).not.toContain("auth.registerDeviceKey");
    });

    test("an upload the server rejects as forbidden keeps this phone's registration and rechecks keys in the same run", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      uploadGroup = async () => {
        throw Object.assign(new Error("The active device is not registered."), {
          data: { code: "FORBIDDEN" },
        });
      };

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requests[0]).toBe("groupTracking.uploadBatch");
      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
      expect(requests).not.toContain("auth.registerDeviceKey");
      expect(registeredDevice?.deviceId).toBe("device-1");
    });

    test("an upload with an unknown epoch rechecks keys in the same run", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      uploadGroup = async () => {
        throw Object.assign(new Error("Epoch does not belong to this group."), {
          data: { code: "BAD_REQUEST" },
        });
      };

      await syncBackgroundTracking();

      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
      expect(requests).not.toContain("auth.registerDeviceKey");
      expect(deleted).toEqual([[1]]);
    });

    test("an upload with expired points rechecks keys in the same run", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      uploadGroup = async () => ({
        accepted: [],
        duplicates: [],
        expired: [pointId("point-1")],
      });

      await syncBackgroundTracking();

      expect(requests[0]).toBe("groupTracking.uploadBatch");
      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
      expect(deleted.flat()).toEqual([1]);
    });

    test("an upload without expired points doesn't recheck keys", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];

      await syncBackgroundTracking();

      expect(requests).toEqual(["groupTracking.uploadBatch"]);
    });

    const rejectUploads = (code: string, message: string, reason?: string) => {
      uploadGroup = async () => {
        throw Object.assign(new Error(message), { data: { code, reason } });
      };
    };

    const queueOldKeyPoint = () => {
      pendingCiphertexts = [
        {
          ...createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
          epochId: "epoch-0",
        },
      ];
    };

    test("an unregistered device reason rechecks keys whatever the message says", async () => {
      await startTracking();
      queueOldKeyPoint();
      rejectUploads("FORBIDDEN", "Reworded by the server", "DEVICE_NOT_REGISTERED");

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
      expect(requests).not.toContain("auth.registerDeviceKey");
      expect(requeued.map(({ ids }) => ids)).toEqual([[1]]);
    });

    test("the old English message without a reason no longer rechecks keys", async () => {
      await startTracking();
      queueOldKeyPoint();
      rejectUploads("FORBIDDEN", "The active device is not registered.");

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requests).toEqual(["groupTracking.uploadBatch"]);
    });

    for (const reason of ["NOT_GROUP_MEMBER", "GROUP_GONE"]) {
      test(`a ${reason} rejection drops every point queued for that group`, async () => {
        await startTracking();
        pendingCiphertexts = [
          { ...createQueueItem({ clientPointId: "point-1", groupId: "group-3", id: 1 }) },
          createQueueItem({ clientPointId: "point-2", groupId: "group-3", id: 2 }),
          createQueueItem({ clientPointId: "point-3", groupId: "group-1", id: 3 }),
        ];
        uploadGroup = async ({ groupId, points }) => {
          if (groupId === "group-3") {
            throw Object.assign(new Error("Any message"), {
              data: { code: "FORBIDDEN", reason },
            });
          }
          return {
            accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
            duplicates: [],
          };
        };

        await syncBackgroundTracking();
        await syncBackgroundTracking();

        expect(deletedGroups).toEqual([{ owner: requestedOwners[0] ?? "", groupId: "group-3" }]);
        expect(requeued).toEqual([]);
        expect(uploadCalls.filter(({ groupId }) => groupId === "group-3")).toHaveLength(1);
      });
    }

    test("an upload limit keeps the points for a later retry", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      rejectUploads("TOO_MANY_REQUESTS", "Too many requests.", "UPLOAD_LIMIT_REACHED");

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requests).toEqual(["groupTracking.uploadBatch"]);
      expect(requeued.map(({ ids }) => ids)).toEqual([[1]]);
      expect(deleted.flat()).toEqual([]);
    });

    test("being removed from a group rechecks keys without registering again", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      rejectUploads("FORBIDDEN", "You are not a member of this group");

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
      expect(requests).not.toContain("auth.registerDeviceKey");
    });

    test("points still queued for a group this phone has left are uploaded once, then dropped", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-3", id: 1 }),
      ];
      rejectUploads("FORBIDDEN", "You are not a member of this group", "NOT_GROUP_MEMBER");

      for (let index = 0; index < 3; index++) {
        await syncBackgroundTracking();
      }

      expect(requests).toEqual(["groupTracking.uploadBatch"]);
    });

    test("a network failure keeps the points for a later retry", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      uploadGroup = async () => {
        throw new TRPCClientError("Network request failed");
      };

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requeued.map(({ ids }) => ids)).toEqual([[1]]);
      expect(deleted.flat()).toEqual([]);
      expect(deletedGroups).toEqual([]);
    });

    test("a key check that finds a group gone drops the points queued for it", async () => {
      await startTracking();
      expect(provisionedKeys.map(({ groupId }) => groupId).sort()).toEqual(["group-1", "group-2"]);
      membershipGroups = [{ id: "group-1", members: [{ id: "member-1" }] }];

      await reconcileTrackingKeys({ startCapture: true, force: true });

      expect(deletedGroups.map(({ groupId }) => groupId)).toEqual(["group-2"]);
      expect(provisionedKeys.map(({ groupId }) => groupId)).toEqual(["group-1"]);
    });

    test("points from an old device key that the server no longer knows don't register again", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({
          clientPointId: "point-1",
          groupId: "group-1",
          id: 1,
          senderDeviceId: "device-old",
        }),
      ];
      rejectUploads("FORBIDDEN", "The active device is not registered.");

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");
      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requests).toEqual(["groupTracking.uploadBatch", "groupTracking.uploadBatch"]);
    });

    test("a point for an epoch the server says isn't this group's is dropped, after one retry without the alerts cursor", async () => {
      await startTracking();
      pendingCiphertexts = [
        {
          ...createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
          epochId: "epoch-0",
        },
      ];
      rejectUploads("BAD_REQUEST", "Epoch does not belong to this group.");

      await syncBackgroundTracking();

      expect(requests).toEqual(["groupTracking.uploadBatch", "groupTracking.uploadBatch"]);
      expect(uploadCalls.map((call) => call.placeAlertsCursor)).toEqual([null, undefined]);
      expect(deleted).toEqual([[1]]);
    });

    test("a key check that's due but failing is tried once per sync, not again after a failed upload", async () => {
      jest.useFakeTimers();
      try {
        await startTracking();
        jest.advanceTimersByTime(5 * 60 * 1000);
        failedLatestGroup = "group-2";
        pendingCiphertexts = [
          createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
        ];
        rejectUploads("INTERNAL_SERVER_ERROR", "Server unavailable");

        await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

        expect(requests.filter((request) => request === "groupMembership.list")).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });

    test("a failed upload that isn't about keys doesn't recheck them", async () => {
      await startTracking();
      pendingCiphertexts = [
        createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 }),
      ];
      uploadGroup = async () => {
        throw new Error("Network request failed");
      };

      await expect(syncBackgroundTracking()).rejects.toThrow("Tracking upload failed");

      expect(requests).toEqual(["groupTracking.uploadBatch"]);
    });

    test("a membership change seen on the map rechecks keys on the next sync", async () => {
      await startTracking();
      noteGroupMembership(membershipGroups);
      await syncBackgroundTracking();
      expect(requests).toEqual([]);

      membershipGroups = [
        ...membershipGroups,
        { id: "group-1", members: [{ id: "member-1" }, { id: "member-3" }] },
      ].slice(1);
      noteGroupMembership(membershipGroups);
      await syncBackgroundTracking();

      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
    });

    test("a key check that couldn't finish runs again on the next sync", async () => {
      captureRunning = true;
      failedLatestGroup = "group-2";
      await reconcileTrackingKeys({ startCapture: true, force: true });
      requests.length = 0;

      await syncBackgroundTracking();

      expect(requests).toEqual(expect.arrayContaining(keyCheckRequests));
    });

    test("signing out clears the cache, so the next account registers and checks keys", async () => {
      await startTracking();
      await revokeTrackingAccess();
      currentUserId = "user-2";
      resumeTracking();

      await reconcileTrackingKeys({ startCapture: true });

      expect(requests).toEqual(
        expect.arrayContaining(["auth.registerDeviceKey", ...keyCheckRequests]),
      );
    });

    test("the queue owner comes from the cached registration", async () => {
      await startTracking();
      queueBothGroups();

      await flushPendingTrackingPoints();

      expect(ownerContextCalls).toBe(0);
      expect(requestedOwners).toEqual([JSON.stringify(["https://api.example.test", "user-1"])]);
    });

    test("turning sharing on straight after a key check with sharing off provisions keys", async () => {
      await reconcileTrackingKeys({ startCapture: false, force: true });

      await reconcileTrackingKeys({ startCapture: true });

      expect(provisionedKeys.map(({ groupId }) => groupId).sort()).toEqual(["group-1", "group-2"]);
      expect(startCaptureCalls).toBe(1);
    });

    test("a change found by a background sync is kept until the app takes it", async () => {
      takeKeyAccessChange();
      captureRunning = true;
      await reconcileTrackingKeys({ startCapture: true, force: true });
      takeKeyAccessChange();
      jest.useFakeTimers();
      try {
        jest.advanceTimersByTime(4 * 60 * 1000);
        membershipGroups = [{ id: "group-1", members: [{ id: "member-1" }] }];

        await syncBackgroundTracking();

        expect(takeKeyAccessChange()).toBe(true);
        expect(takeKeyAccessChange()).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    test("reports a change only when the key check finds something new", async () => {
      captureRunning = true;
      expect(await reconcileTrackingKeys({ startCapture: true, force: true })).toBe(true);
      expect(await reconcileTrackingKeys({ startCapture: true, force: true })).toBe(false);

      membershipGroups = [{ id: "group-1", members: [{ id: "member-1" }] }];
      expect(await reconcileTrackingKeys({ startCapture: true, force: true })).toBe(true);
    });
  });
});

const createDeviceRemovedError = () =>
  new TRPCClientError("This device was removed.", {
    result: {
      error: {
        code: -32001,
        message: "This device was removed.",
        data: { code: "UNAUTHORIZED", cause: deviceRemovedCause, reason: deviceRemovedCause },
      },
    },
  });
