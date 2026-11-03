import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  encodeBase64,
  generateGroupEpochKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const deviceKeyPair = createDeviceKeyPair();
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
const deleted: number[][] = [];
const requeued: Array<{ ids: number[]; error: string | null | undefined }> = [];
const uploadCalls: Array<{ groupId: string; points: unknown[] }> = [];
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
}> = [];
const recordedUploads: Array<{ deviceId: string; groupId: string; timestamp: string }> = [];
let networkConnected = true;
let captureRunning = false;
let startCaptureCalls = 0;
let stopCaptureCalls = 0;
let onStopCapture: (() => void) | null = null;
let refreshCaptureCalls = 0;
let failRefreshCapture = false;
let failRegistration = false;
let brokenGroupKey = false;
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
  ensureDeviceKeyRegistration: async () => {
    if (failRegistration) throw new Error("offline");
    onRegistration?.();
    await registrationWait;
    return { deviceId: "device-1", privateKey: deviceKeyPair.privateKey };
  },
}));

mock.module("./api.ts", () => ({
  trpcClient: {
    groupMembership: {
      list: {
        query: async () => [{ id: "group-1" }, { id: "group-2" }],
      },
    },
    groupEpoch: {
      getLatest: {
        query: async ({ groupId }: { groupId: string }) => ({
          epochId: groupId === "group-1" ? "epoch-1" : "epoch-2",
          groupId,
        }),
      },
      getWrappedKey: {
        query: async ({ epochId, groupId }: { epochId: string; groupId: string }) =>
          wrapEpochKeyForRecipient({
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
          }),
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
    provisionEpochKeys: (keys: unknown[]) => {
      provisionCalls.push(keys);
    },
    revokeEpochKeys: (groupIds?: string[] | null) => {
      revokedGroups.push(groupIds);
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
    listPendingCiphertexts: async () => pendingCiphertexts,
    markCiphertextsInFlight: async (ids: number[]) => {
      markedInFlight.push(ids);
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
  flushPendingTrackingPoints,
  reconcileTrackingKeys,
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
    deleted.length = 0;
    requeued.length = 0;
    uploadCalls.length = 0;
    recordedUploads.length = 0;
    pendingCiphertexts = [];
    captureRunning = false;
    networkConnected = true;
    startCaptureCalls = 0;
    stopCaptureCalls = 0;
    onStopCapture = null;
    refreshCaptureCalls = 0;
    failRefreshCapture = false;
    failRegistration = false;
    brokenGroupKey = false;
    registrationWait = null;
    onRegistration = null;
    uploadGroup = async ({ points }) => ({
      accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
      duplicates: [],
    });
  });

  test("replaces native keys with every current group epoch before starting capture", async () => {
    await reconcileTrackingKeys({ startCapture: true });

    expect(revokedGroups).toEqual([undefined]);
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
    networkConnected = false;
    pendingCiphertexts = [createQueueItem({ clientPointId: "point-1", groupId: "group-1", id: 1 })];
    uploadGroup = async () => {
      throw new Error("Network request failed");
    };

    await expect(syncBackgroundTracking()).resolves.toBeUndefined();
    expect(deleted).toEqual([]);
    expect(recordedUploads).toEqual([]);
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

  test("deletes permanently rejected batches", async () => {
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

    await flushPendingTrackingPoints();

    expect(uploadCalls.map(({ points }) => points.length)).toEqual([2, 1, 1]);
    expect(
      uploadCalls.some(
        ({ points }) =>
          points.length === 1 &&
          (points[0] as { clientPointId: string }).clientPointId === "point-valid",
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

    await flushPendingTrackingPoints();

    expect(uploadCalls.map(({ points }) => points.length)).toEqual([1, 1]);
    expect(
      uploadCalls.some(
        ({ points }) => (points[0] as { clientPointId: string }).clientPointId === "point-valid",
      ),
    ).toBe(true);
    expect(deleted.flat().sort()).toEqual([1, 2]);
    expect(requeued).toEqual([]);
  });

  test("revokes every native key and stops capture", async () => {
    await revokeTrackingAccess();

    expect(revokedGroups).toEqual([undefined]);
    expect(stopCaptureCalls).toBe(1);
  });
});
