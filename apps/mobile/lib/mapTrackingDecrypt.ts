import {
  type DevicePrivateKeyMaterial,
  decodeJsonPayload,
  decryptGroupPayload,
  type EpochKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
  unwrapEpochKey,
  validateTrackingPointV1,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  type WrappedEpochKey,
} from "@openbeacon/encryption";
import type { LiveMapEntry } from "./liveMapReducer.ts";
import type { MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";

export const MISSING_EPOCH_KEY_RETRY_MS = 60_000;

export const createMapTrackingDecryptPoint = ({
  ensureDeviceKeys,
  getWrappedEpochKey,
  now = () => Date.now(),
}: {
  ensureDeviceKeys: () => Promise<{
    deviceId: string;
    privateKey: DevicePrivateKeyMaterial;
  }>;
  getWrappedEpochKey: (input: {
    deviceId: string;
    epochId: string;
    groupId: string;
  }) => Promise<WrappedEpochKey | null>;
  now?: () => number;
}) => {
  const epochKeys = new Map<string, EpochKeyMaterial>();
  const missingUntilByKey = new Map<string, number>();
  const inflightByKey = new Map<string, Promise<EpochKeyMaterial | null>>();

  const getCacheKey = (groupId: string, epochId: string) =>
    `${groupId.length}:${groupId}:${epochId}`;

  const groupKeyPrefix = (groupId: string) => `${groupId.length}:${groupId}:`;

  const loadEpochKey = async ({ epochId, groupId }: { epochId: string; groupId: string }) => {
    const cacheKey = getCacheKey(groupId, epochId);
    const cached = epochKeys.get(cacheKey);
    if (cached) {
      return cached;
    }

    const missingUntil = missingUntilByKey.get(cacheKey);
    if (missingUntil !== undefined && now() < missingUntil) {
      return null;
    }

    const inflight = inflightByKey.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    let loadPromise: Promise<EpochKeyMaterial | null>;
    loadPromise = (async () => {
      const deviceKeys = await ensureDeviceKeys();
      const wrappedEpochKey = await getWrappedEpochKey({
        deviceId: deviceKeys.deviceId,
        epochId,
        groupId,
      });

      const stillInFlight = () => inflightByKey.get(cacheKey) === loadPromise;

      if (!wrappedEpochKey || wrappedEpochKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
        if (stillInFlight()) {
          missingUntilByKey.set(cacheKey, now() + MISSING_EPOCH_KEY_RETRY_MS);
        }
        return null;
      }

      try {
        const epochKey = unwrapEpochKey({
          recipientDeviceId: deviceKeys.deviceId,
          recipientPrivateKey: deviceKeys.privateKey,
          wrappedEpochKey: {
            ...wrappedEpochKey,
            algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
          },
        });
        if (stillInFlight()) {
          missingUntilByKey.delete(cacheKey);
          epochKeys.set(cacheKey, epochKey);
        }
        return epochKey;
      } catch {
        if (stillInFlight()) {
          missingUntilByKey.set(cacheKey, now() + MISSING_EPOCH_KEY_RETRY_MS);
        }
        return null;
      }
    })();

    inflightByKey.set(cacheKey, loadPromise);

    try {
      return await loadPromise;
    } finally {
      inflightByKey.delete(cacheKey);
    }
  };

  const decryptPoint = Object.assign(
    async ({
      groupId,
      point,
    }: {
      groupId: string;
      point: MapTrackingEncryptedPoint;
    }): Promise<
      { entry: LiveMapEntry; status: "ok" } | { status: "ignored" } | { status: "undecryptable" }
    > => {
      if (point.kind !== TRACKING_POINT_KIND || point.algorithm !== PAYLOAD_ENCRYPTION_ALGORITHM) {
        return { status: "ignored" };
      }

      const epochKey = await loadEpochKey({
        epochId: point.epochId,
        groupId,
      });

      if (!epochKey) {
        return { status: "undecryptable" };
      }

      try {
        const decrypted = decryptGroupPayload({
          encryptedPayload: {
            algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
            ciphertext: point.ciphertext,
            createdAt: point.createdAt,
            epochId: point.epochId,
            groupId,
            kind: point.kind,
            nonce: point.nonce,
            senderDeviceId: point.senderDeviceId,
          },
          epochKey,
          expectedMetadata: {
            epochId: point.epochId,
            groupId,
            kind: point.kind,
            senderDeviceId: point.senderDeviceId,
          },
        });
        const trackingPoint = validateTrackingPointV1(decodeJsonPayload(decrypted.bytes));

        return {
          status: "ok",
          entry: {
            battery: trackingPoint.battery,
            latitude: trackingPoint.latitude,
            longitude: trackingPoint.longitude,
            serverCreatedAt: point.createdAt,
            serverId: point.id,
            sourceGroupId: groupId,
            speed: trackingPoint.speed,
            timestamp: trackingPoint.timestamp,
            userId: point.senderUserId,
          },
        };
      } catch {
        return { status: "undecryptable" };
      }
    },
    {
      clear: () => {
        epochKeys.clear();
        missingUntilByKey.clear();
        inflightByKey.clear();
      },
      clearGroup: (groupId: string) => {
        const prefix = groupKeyPrefix(groupId);
        for (const key of [...epochKeys.keys()]) {
          if (key.startsWith(prefix)) {
            epochKeys.delete(key);
          }
        }
        for (const key of [...missingUntilByKey.keys()]) {
          if (key.startsWith(prefix)) {
            missingUntilByKey.delete(key);
          }
        }
        for (const key of [...inflightByKey.keys()]) {
          if (key.startsWith(prefix)) {
            inflightByKey.delete(key);
          }
        }
      },
    },
  );

  return decryptPoint;
};
