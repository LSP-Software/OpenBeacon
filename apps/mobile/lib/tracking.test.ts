import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  encodeBase64,
  generateGroupEpochKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";

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
let captureRunning = false;
let startCaptureCalls = 0;
let stopCaptureCalls = 0;
let uploadGroup = async ({ points }: { groupId: string; points: unknown[] }) => ({
  accepted: points.map((point) => (point as { clientPointId: string }).clientPointId),
  duplicates: [],
});

mock.module("react-native", () => ({
  Platform: {
    OS: "android",
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: async () => ({
    deviceId: "device-1",
    privateKey: deviceKeyPair.privateKey,
  }),
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
              publicKey: deviceKeyPair.publicKey,
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
    stopCapture: async () => {
      stopCaptureCalls += 1;
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

const { flushPendingTrackingPoints, reconcileTrackingKeys, revokeTrackingAccess } = await import(
  "./tracking.ts"
);

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
    pendingCiphertexts = [];
    captureRunning = false;
    startCaptureCalls = 0;
    stopCaptureCalls = 0;
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

  test("does not expose or replace keys when native metadata is already current", async () => {
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

    await flushPendingTrackingPoints();

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
