import {
  decodeJsonPayload,
  decryptGroupPayload,
  type EpochKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
  validateTrackingPointV1,
} from "@openbeacon/encryption";
import type { LiveMapEntry } from "./liveMapReducer.ts";
import type { MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";

export const MISSING_EPOCH_KEY_RETRY_MS = 60_000;

export const createMapTrackingDecryptPoint = ({
  now = () => Date.now(),
  resolveEpochKey,
}: {
  now?: () => number;
  resolveEpochKey: (input: {
    epochId: string;
    groupId: string;
  }) => Promise<EpochKeyMaterial | null>;
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

    const loadPromise: Promise<EpochKeyMaterial | null> = (async () => {
      const epochKey = await resolveEpochKey({ epochId, groupId });
      const stillInFlight = () => inflightByKey.get(cacheKey) === loadPromise;
      if (!stillInFlight()) return epochKey;
      if (epochKey) {
        missingUntilByKey.delete(cacheKey);
        epochKeys.set(cacheKey, epochKey);
      } else {
        missingUntilByKey.set(cacheKey, now() + MISSING_EPOCH_KEY_RETRY_MS);
      }
      return epochKey;
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
            deviceId: point.senderDeviceId,
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
