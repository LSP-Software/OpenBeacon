import type { EpochKeyMaterial } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { errorReason } from "./errorReason.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { decryptPlaceGeometry, encryptPlaceGeometry } from "./places.ts";

const running = new Map<string, Promise<number>>();

const reEncryptOldPlaces = async (groupId: string) => {
  const [list, device] = await Promise.all([
    trpcClient.groupPlaces.list.query({ groupId }),
    ensureDeviceKeyRegistration(),
  ]);
  const { latestEpochId } = list;
  const oldPlaces = list.places.filter((place) => place.epochId !== latestEpochId);
  if (!latestEpochId || oldPlaces.length === 0) return { moved: 0, changed: false };
  const latestKey = await resolveEpochKey({ device, epochId: latestEpochId, groupId });
  if (!latestKey) return { moved: 0, changed: false };
  const epochKeys = new Map<string, Promise<EpochKeyMaterial | null>>();
  const epochKey = (epochId: string) => {
    const loaded = epochKeys.get(epochId) ?? resolveEpochKey({ device, epochId, groupId });
    epochKeys.set(epochId, loaded);
    return loaded;
  };
  const requests = await Promise.all(
    oldPlaces.map(async (place) => {
      const key = await epochKey(place.epochId);
      const geometry = key ? decryptPlaceGeometry({ epochKey: key, groupId, place }) : null;
      if (!geometry) return [];
      return [
        {
          placeId: place.id,
          name: place.name,
          emoji: place.emoji,
          expectedCiphertext: place.ciphertext,
          geometry: encryptPlaceGeometry({
            epochId: latestEpochId,
            epochKey: latestKey,
            geometry,
            groupId,
            senderDeviceId: device.deviceId,
          }),
        },
      ];
    }),
  );
  const places = requests.flat();
  if (places.length === 0) return { moved: 0, changed: false };
  const result = await trpcClient.groupPlaces.reEncrypt.mutate({ groupId, places });
  return { moved: result.places.length, changed: result.changed.length > 0 };
};

const catchUp = async (groupId: string) => {
  const first = await tryCatch(reEncryptOldPlaces(groupId));
  if (!first.error && !first.data.changed) return first.data.moved;
  if (first.error) {
    const reason = errorReason(first.error);
    if (reason === "EPOCH_ROTATION_PENDING") await rotateGroupEpochIfRequired(groupId);
    else if (reason !== "EPOCH_NOT_LATEST") throw first.error;
  }
  const second = await reEncryptOldPlaces(groupId);
  return (first.data?.moved ?? 0) + second.moved;
};

export const catchUpGroupPlaces = (groupId: string) => {
  const existing = running.get(groupId);
  if (existing) return existing;
  const current = catchUp(groupId).finally(() => running.delete(groupId));
  running.set(groupId, current);
  return current;
};
