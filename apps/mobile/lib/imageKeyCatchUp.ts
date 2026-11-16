import { decryptImageKey, encryptImageKey, type EpochKeyMaterial } from "@openbeacon/encryption";
import { MAX_IMAGE_KEY_REENCRYPTS } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { errorReason } from "./errorReason.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { imageFileNameFromUrl } from "./imageCache.ts";
import { storeOwnImageKeyInGroup } from "./imageKeys.ts";

const running = new Map<string, Promise<number>>();

const reEncryptOldImageKeys = async ({ groupId, userId }: { groupId: string; userId: string }) => {
  const [groups, latest, device] = await Promise.all([
    trpcClient.groupMembership.list.query(),
    trpcClient.groupEpoch.getLatest.query({ groupId }),
    ensureDeviceKeyRegistration(),
  ]);
  const group = groups.find(({ id }) => id === groupId);
  if (!group || !latest) return { moved: 0, changed: false, ownKeyMissing: false };
  const me = group.members.find((member) => member.userId === userId);
  const ownKeyMissing = Boolean(me?.image && !me.imageKey);
  const latestEpochId = latest.epochId;
  const stored = [
    {
      target: { kind: "group" as const },
      image: group.image,
      imageKey: group.imageKey,
      kind: "group-image-key" as const,
      ownerId: group.id,
    },
    ...group.members.map((member) => ({
      target: { kind: "member" as const, memberId: member.id },
      image: member.image,
      imageKey: member.imageKey,
      kind: "profile-image-key" as const,
      ownerId: member.userId,
    })),
  ].flatMap(({ image, imageKey, ...rest }) => {
    const fileName = imageFileNameFromUrl(image);
    return fileName && imageKey && imageKey.epochId !== latestEpochId
      ? [{ ...rest, fileName, imageKey }]
      : [];
  });
  if (stored.length === 0) return { moved: 0, changed: false, ownKeyMissing };
  const latestKey = await resolveEpochKey({ device, epochId: latestEpochId, groupId });
  if (!latestKey) return { moved: 0, changed: false, ownKeyMissing };
  const epochKeys = new Map<string, Promise<EpochKeyMaterial | null>>();
  const epochKey = (epochId: string) => {
    const loaded =
      epochKeys.get(epochId) ??
      tryCatch(resolveEpochKey({ device, epochId, groupId })).then((result) => result.data);
    epochKeys.set(epochId, loaded);
    return loaded;
  };
  const requests = await Promise.all(
    stored.map(async ({ fileName, imageKey, kind, ownerId, target }) => {
      const oldKey = await epochKey(imageKey.epochId);
      if (!oldKey) return [];
      const unwrapped = await tryCatch(
        Promise.resolve().then(() =>
          decryptImageKey({
            encryptedKey: imageKey,
            epochKey: oldKey,
            fileName,
            groupId,
            kind,
            ownerId,
          }),
        ),
      );
      if (unwrapped.error) return [];
      return [
        {
          target,
          fileName,
          expectedCiphertext: imageKey.ciphertext,
          key: encryptImageKey({
            epochId: latestEpochId,
            epochKey: latestKey,
            fileName,
            groupId,
            imageKey: unwrapped.data,
            kind,
            ownerId,
            senderDeviceId: device.deviceId,
          }),
        },
      ];
    }),
  );
  const keys = requests.flat();
  let moved = 0;
  let changed = false;
  for (let start = 0; start < keys.length; start += MAX_IMAGE_KEY_REENCRYPTS) {
    const result = await trpcClient.groupImageKeys.reEncrypt.mutate({
      groupId,
      keys: keys.slice(start, start + MAX_IMAGE_KEY_REENCRYPTS),
    });
    moved += result.reEncrypted.length;
    changed ||= result.changed.length > 0;
  }
  return { moved, changed, ownKeyMissing };
};

const catchUp = async (input: { groupId: string; userId: string }) => {
  const { groupId } = input;
  const first = await tryCatch(reEncryptOldImageKeys(input));
  if (first.error) {
    const reason = errorReason(first.error);
    if (reason === "EPOCH_ROTATION_PENDING") await rotateGroupEpochIfRequired(groupId);
    else if (reason === "DEVICE_NOT_REGISTERED") {
      await ensureDeviceKeyRegistration({ linkSession: true });
    } else if (reason !== "EPOCH_NOT_LATEST") throw first.error;
    return (await reEncryptOldImageKeys(input)).moved;
  }
  const stored = first.data.ownKeyMissing
    ? await tryCatch(storeOwnImageKeyInGroup(groupId))
    : { data: false };
  const moved = first.data.moved + (stored.data ? 1 : 0);
  if (!first.data.changed) return moved;
  return moved + (await reEncryptOldImageKeys(input)).moved;
};

export const catchUpGroupImageKeys = ({ groupId, userId }: { groupId: string; userId: string }) => {
  const key = `${userId}:${groupId}`;
  const existing = running.get(key);
  if (existing) return existing;
  const current = catchUp({ groupId, userId }).finally(() => running.delete(key));
  running.set(key, current);
  return current;
};
