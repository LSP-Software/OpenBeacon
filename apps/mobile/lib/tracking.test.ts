import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
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
const requeued: Array<{ ids: number[]; error: string | null | undefined }> = [];
const uploadCalls: Array<{ groupId: string; points: unknown[] }> = [];
const rotationChecks: string[] = [];
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
let failRegistration = false;
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
let backfillErrors = new Map<string, Error>();
let missingHistoryWraps = new Map<string, string[]>();
const backfillQueries: string[] = [];
const captureStateSeenByBackfill: Array<{ provisions: number; starts: number }> = [];
const historyWrapUploads: Array<{ groupId: string; wraps: WrappedHistoryEpochKey[] }> = [];
let registrationWait: Promise<void> | null = null;
let onRegistration: (() => void) | null = null;
let uploadGroup = async ({
  points,
}: {
  groupId: string;
  points: unknown[];
}): Promise<{ accepted: string[]; duplicates: string[] }> => ({
  accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
  duplicates: [],
});

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

mock.module("./deviceKeys.ts", () => ({
  cancelDeviceKeyRegistrations: () => {},
  ensureDeviceKeyRegistration: async () => {
    if (registrationError) throw registrationError;
    if (failRegistration) throw new Error("offline");
    onRegistration?.();
    await registrationWait;
    return { deviceId: "device-1", privateKey: deviceKeyPair.privateKey, userId: currentUserId };
  },
}));

mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async ({ userId, version }: { userId: string; version: number }) =>
    userId === "user-1" && version === 1 ? historyKeyPair.privateKey : null,
  storeHistoryKey: async () => {},
}));

mock.module("./base-url.ts", () => ({ baseUrl: "https://api.example.test" }));

mock.module("./api.ts", () => ({
  trpcClient: {
    auth: {
      deviceKeyContext: {
        query: async () => {
          ownerContextCalls += 1;
          await ownerQueryGate;
          return { userId: currentUserId, recipients: [{ deviceId: "device-1" }] };
        },
      },
    },
    accountRecovery: {
      status: {
        query: async () => {
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
        query: async () => [{ id: "group-1" }, { id: "group-2" }],
      },
    },
    groupEpoch: {
      listHistoryBackfill: {
        query: async ({ groupId }: { groupId: string }) => {
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
          historyWrapUploads.push(input);
          missingHistoryWraps.delete(input.groupId);
          return { added: input.wraps.length };
        },
      },
      rotationContext: {
        query: async ({ groupId }: { groupId: string }) => {
          rotationChecks.push(groupId);
          if (rotationError && groupId === "group-1") throw rotationError;
          if (failRotation || groupId === failedGroup) throw new Error("Rotation unavailable");
          return null;
        },
      },
      getLatest: {
        query: async ({ groupId }: { groupId: string }) => {
          if (groupId === failedLatestGroup) throw new Error("Latest epoch unavailable");
          return { epochId: groupId === "group-1" ? "epoch-1" : "epoch-2", groupId };
        },
      },
      getEpochKeyWraps: {
        query: async ({ epochId, groupId }: { epochId: string; groupId: string }) => {
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
    groupTracking: {
      uploadBatch: {
        mutate: async (input: { groupId: string; points: unknown[] }) => {
          uploadCalls.push(input);
          return uploadGroup(input);
        },
      },
    },
  },
}));

mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    setQueueOwner: () => {},
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
    },
    listProvisionedEpochKeys: () => provisionedKeys,
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
    requeueCiphertexts: async (ids: number[], error?: string | null) => {
      requeued.push({ ids, error });
    },
  },
}));

const {
  dismissTrackingQueueEviction,
  flushPendingTrackingPoints,
  getTrackingQueueEviction,
  getUnassignedTrackingPoints,
  prepareTrackingSignOut,
  reconcileTrackingKeys,
  recoverUnassignedTrackingPoints,
  resumeTracking,
  revokeTrackingAccess,
  syncBackgroundTracking,
} = await import("./tracking.ts");

const createQueueItem = ({
  clientPointId,
  groupId,
  id,
  senderDeviceId = "device-1",
}: {
  clientPointId: string;
  groupId: string;
  id: number;
  senderDeviceId?: string;
}) => ({
  id,
  clientPointId,
  captureId: `capture-${id}`,
  groupId,
  epochId: `epoch-${groupId.slice(-1)}`,
  senderDeviceId,
  kind: "trackingPoint",
  algorithm: "XChaCha20-Poly1305",
  nonce: "nonce",
  ciphertext: "ciphertext",
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
    requeued.length = 0;
    uploadCalls.length = 0;
    rotationChecks.length = 0;
    requestedOwners.length = 0;
    currentUserId = "user-1";
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
    failRegistration = false;
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
    uploadGroup = async ({ points }) => ({
      accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
      duplicates: [],
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
    await expect(previous).resolves.toBeUndefined();
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
          (points[0] as { clientPointId: string }).clientPointId === "invalid"
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

  test("backfills an epoch an old client created without a history wrap on the next reconcile", async () => {
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

  test("checks and sweeps for backfill at most once every ten minutes per user", async () => {
    jest.useFakeTimers();
    try {
      await reconcileTrackingKeys({ startCapture: true });
      await reconcileTrackingKeys({ startCapture: false });

      expect(recoveryStatusCalls).toBe(1);
      expect(backfillQueries.sort()).toEqual(["group-1", "group-2"]);

      jest.advanceTimersByTime(10 * 60 * 1000);
      await reconcileTrackingKeys({ startCapture: false });

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

  test("skips every backfill call when the account has no recovery phrase", async () => {
    recoveryStatus = { currentHistoryKey: null, recoveryKey: null };
    await reconcileTrackingKeys({ startCapture: true });
    await reconcileTrackingKeys({ startCapture: false });

    expect(backfillQueries).toEqual([]);
    expect(startCaptureCalls).toBe(1);
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
    expect(provisionedKeys.map(({ epochId }) => epochId)).toEqual(["old", "epoch-2"]);
    failedWrappedGroup = null;
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys.map(({ epochId }) => epochId)).toEqual(["epoch-1", "epoch-2"]);
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
    expect(provisionedKeys.map(({ epochId }) => epochId)).toEqual(["old", "epoch-2"]);
    expect(stopCaptureCalls).toBe(0);
    missingWrappedGroup = null;
    await reconcileTrackingKeys({ startCapture: true });
    expect(provisionedKeys.map(({ epochId }) => epochId)).toEqual(["epoch-1", "epoch-2"]);
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
    uploadGroup = async () => ({ accepted: [], duplicates: ["point-1"] });
    await flushPendingTrackingPoints();
    expect(recordedUploads).toHaveLength(0);
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
      expect.objectContaining({ clientPointId: "kept" }),
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

  test("retains rejected batches", async () => {
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw Object.assign(new Error("Epoch does not belong to this group."), {
        data: {
          code: "BAD_REQUEST",
        },
      });
    };

    await expect(flushPendingTrackingPoints()).rejects.toThrow("Tracking upload failed");

    expect(deleted).toEqual([]);
    expect(requeued).toEqual([
      { ids: [1], error: "BAD_REQUEST: Epoch does not belong to this group." },
    ]);
  });

  test("isolates a permanently invalid point without discarding valid points", async () => {
    pendingCiphertexts = [
      createQueueItem({ clientPointId: "point-valid", groupId: "group-1", id: 1 }),
      createQueueItem({ clientPointId: "point-invalid", groupId: "group-1", id: 2 }),
    ];
    uploadGroup = async ({ points }) => {
      if (
        points.some(
          (point) => (point as { clientPointId: string }).clientPointId === "point-invalid",
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

    await expect(flushPendingTrackingPoints()).rejects.toThrow("Tracking upload failed");

    expect(uploadCalls.map(({ points }) => points.length)).toEqual([2, 1, 1]);
    expect(
      uploadCalls.some(
        ({ points }) =>
          points.length === 1 &&
          (points[0] as { clientPointId: string }).clientPointId === "point-valid",
      ),
    ).toBe(true);
    expect(deleted.flat()).toEqual([1]);
    expect(requeued).toEqual([
      { ids: [2], error: "BAD_REQUEST: Epoch does not belong to this group." },
    ]);
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
        ({ points }) => (points[0] as { clientPointId: string }).clientPointId === "point-valid",
      ),
    ).toBe(true);
    expect(deleted.flat()).toEqual([1]);
    expect(requeued).toEqual([
      { ids: [2], error: "FORBIDDEN: The active device is not registered." },
    ]);
  });

  test("revokes every native key and stops capture", async () => {
    await revokeTrackingAccess();

    expect(revokedGroups).toEqual([undefined]);
    expect(stopCaptureCalls).toBe(1);
  });

  test("stops capture when native key removal fails", async () => {
    failRevokeEpochKeys = true;

    await expect(revokeTrackingAccess()).rejects.toThrow("revoke failed");

    expect(stopCaptureCalls).toBe(1);
  });
});
