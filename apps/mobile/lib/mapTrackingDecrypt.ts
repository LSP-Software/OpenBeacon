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

export const createMapTrackingDecryptPoint = ({
  ensureDeviceKeys,
  getWrappedEpochKey,
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
}) => {
  const epochKeys = new Map<string, EpochKeyMaterial>();

  const getCacheKey = (groupId: string, epochId: string) => `${groupId}:${epochId}`;

  const loadEpochKey = async ({ epochId, groupId }: { epochId: string; groupId: string }) => {
    const cacheKey = getCacheKey(groupId, epochId);
    const cached = epochKeys.get(cacheKey);
    if (cached) {
      return cached;
    }

    const deviceKeys = await ensureDeviceKeys();
    const wrappedEpochKey = await getWrappedEpochKey({
      deviceId: deviceKeys.deviceId,
      epochId,
      groupId,
    });

    if (!wrappedEpochKey || wrappedEpochKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
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
      epochKeys.set(cacheKey, epochKey);
      return epochKey;
    } catch {
      return null;
    }
  };

  return async ({
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
  };
};
