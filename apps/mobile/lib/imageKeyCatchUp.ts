import { decryptImageKey, encryptImageKey, type EpochKeyMaterial } from "@openbeacon/encryption";
import { MAX_IMAGE_KEY_REENCRYPTS } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { type RouterOutputs, trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { errorReason } from "./errorReason.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { imageFileNameFromUrl } from "./imageCache.ts";
import { storeOwnImageKeyInGroup } from "./imageKeys.ts";

const running = new Map<string, Promise<number>>();

const fetchGroups = () => trpcClient.groupMembership.list.query();

const reEncryptOldImageKeys = async ({
  groupId,
  groups,
  userId,
}: {
  groupId: string;
  groups: Groups;
  userId: string;
}) => {
  const [list, latest, device] = await Promise.all([
    groups(),
    trpcClient.groupEpoch.getLatest.query({ groupId }),
    ensureDeviceKeyRegistration(),
  ]);
  const group = list.find(({ id }) => id === groupId);
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
  const epochKeys = new Map<string, Promise<EpochKeyMaterial | null>>();
  const epochKey = (epochId: string) => {
    const loaded =
      epochKeys.get(epochId) ??
      tryCatch(resolveEpochKey({ device, epochId, groupId })).then((result) => result.data);
    epochKeys.set(epochId, loaded);
    return loaded;
  };
  const unwrapped = await Promise.all(
    stored.map(async ({ fileName, imageKey, kind, ownerId, target }) => {
      const oldKey = await epochKey(imageKey.epochId);
      if (!oldKey) return [];
      const opened = await tryCatch(
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
      if (opened.error) return [];
      return [
        {
          target,
          fileName,
          kind,
          ownerId,
          expectedCiphertext: imageKey.ciphertext,
          imageKey: opened.data,
        },
      ];
    }),
  );
  const readable = unwrapped.flat();
  if (readable.length === 0) return { moved: 0, changed: false, ownKeyMissing };
  const latestKey = await resolveEpochKey({ device, epochId: latestEpochId, groupId });
  if (!latestKey) return { moved: 0, changed: false, ownKeyMissing };
  const keys = readable.map(
    ({ expectedCiphertext, fileName, imageKey, kind, ownerId, target }) => ({
      target,
      fileName,
      expectedCiphertext,
      key: encryptImageKey({
        epochId: latestEpochId,
        epochKey: latestKey,
        fileName,
        groupId,
        imageKey,
        kind,
        ownerId,
        senderDeviceId: device.deviceId,
      }),
    }),
  );
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

const catchUp = async ({
  groupId,
  groups,
  userId,
}: {
  groupId: string;
  groups: Groups;
  userId: string;
}) => {
  const first = await tryCatch(reEncryptOldImageKeys({ groupId, groups, userId }));
  let result = first.data;
  if (first.error) {
    const reason = errorReason(first.error);
    if (reason === "EPOCH_ROTATION_PENDING") await rotateGroupEpochIfRequired(groupId);
    else if (reason === "DEVICE_NOT_REGISTERED") {
      await ensureDeviceKeyRegistration({ linkSession: true });
    } else if (reason !== "EPOCH_NOT_LATEST") throw first.error;
    result = await reEncryptOldImageKeys({ groupId, groups: fetchGroups, userId });
  }
  if (!result) return 0;
  const stored = result.ownKeyMissing
    ? await tryCatch(storeOwnImageKeyInGroup(groupId))
    : { data: false };
  const moved = result.moved + (stored.data ? 1 : 0);
  if (!result.changed) return moved;
  return moved + (await reEncryptOldImageKeys({ groupId, groups: fetchGroups, userId })).moved;
};

export const catchUpGroupImageKeys = ({
  groupId,
  groups = fetchGroups,
  userId,
}: {
  groupId: string;
  groups?: Groups;
  userId: string;
}) => {
  const key = `${userId}:${groupId}`;
  const existing = running.get(key);
  if (existing) return existing;
  const current = catchUp({ groupId, groups, userId }).finally(() => running.delete(key));
  running.set(key, current);
  return current;
};

type Groups = () => Promise<RouterOutputs["groupMembership"]["list"]>;
