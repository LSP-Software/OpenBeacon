import type { EpochKeyMaterial, PlaceGeometryV1 } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { Alert } from "./alert.ts";
import { trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { errorReason } from "./errorReason.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { decryptPlaceGeometry, encryptPlaceGeometry, type GroupPlace } from "./places.ts";

export const groupPlacesQueryKey = (groupId: string, userId: string | undefined) =>
  ["groupPlaces", groupId, userId] as const;

export const loadGroupPlaces = async (groupId: string): Promise<GroupPlace[]> => {
  const [list, device] = await Promise.all([
    trpcClient.groupPlaces.list.query({ groupId }),
    ensureDeviceKeyRegistration(),
  ]);
  const epochKeys = new Map<string, Promise<EpochKeyMaterial | null>>();
  const epochKey = (epochId: string) => {
    const loaded =
      epochKeys.get(epochId) ??
      tryCatch(resolveEpochKey({ device, epochId, groupId })).then((result) => result.data ?? null);
    epochKeys.set(epochId, loaded);
    return loaded;
  };
  return Promise.all(
    list.places.map(async (place) => {
      const key = await epochKey(place.epochId);
      return {
        ...place,
        geometry: key ? decryptPlaceGeometry({ epochKey: key, groupId, place }) : null,
      };
    }),
  );
};

export const savePlace = async ({
  emoji,
  existing,
  geometry,
  groupId,
  name,
}: {
  emoji: string;
  existing: { expectedCiphertext: string; placeId: string } | null;
  geometry: PlaceGeometryV1;
  groupId: string;
  name: string;
}) => {
  const attempt = async () => {
    const device = await ensureDeviceKeyRegistration();
    const latest = await trpcClient.groupEpoch.getLatest.query({ groupId });
    if (!latest) throw new Error("This group isn’t ready yet. Try again in a moment.");
    const epochKey = await resolveEpochKey({ device, epochId: latest.epochId, groupId });
    if (!epochKey) throw new Error("This phone can’t use this group’s current key yet.");
    const encrypted = encryptPlaceGeometry({
      epochId: latest.epochId,
      epochKey,
      geometry,
      groupId,
      senderDeviceId: device.deviceId,
    });
    if (existing) {
      return trpcClient.groupPlaces.update.mutate({
        emoji,
        expectedCiphertext: existing.expectedCiphertext,
        geometry: encrypted,
        groupId,
        name,
        placeId: existing.placeId,
      });
    }
    return trpcClient.groupPlaces.create.mutate({ emoji, geometry: encrypted, groupId, name });
  };
  const first = await tryCatch(attempt());
  if (!first.error) return first.data;
  const reason = errorReason(first.error);
  if (reason === "EPOCH_ROTATION_PENDING") {
    await rotateGroupEpochIfRequired(groupId);
    return attempt();
  }
  if (reason === "EPOCH_NOT_LATEST") return attempt();
  throw first.error;
};

export const confirmDeletePlace = ({
  groupId,
  name,
  onDeleted,
  placeId,
}: {
  groupId: string;
  name: string;
  onDeleted: () => void;
  placeId: string;
}) =>
  Alert.alert(
    `Delete ${name}?`,
    `${name} will be deleted for everyone in the group, along with its recent arrivals and departures.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const result = await tryCatch(trpcClient.groupPlaces.delete.mutate({ groupId, placeId }));
          if (result.error && errorReason(result.error) !== "PLACE_GONE") {
            Alert.alert("Unable to delete place", result.error.message);
            return;
          }
          onDeleted();
        },
      },
    ],
  );
