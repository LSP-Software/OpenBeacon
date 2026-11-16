import {
  decodeBase64,
  decryptImageKey,
  encryptImageKey,
  ImageKeyMaterial,
  type ImageKeyKind,
  sealProfileImageKey,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { type RouterOutputs, trpcClient } from "./api.ts";
import { authClient } from "./auth-client.ts";
import { getCurrentHistoryKeyState } from "./currentHistoryKey.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { type EpochKeyDevice, resolveEpochKey } from "./epochKeys.ts";
import { errorReason } from "./errorReason.ts";
import { rotateGroupEpochIfRequired } from "./groupEncryption.ts";
import { imageFileNameFromUrl } from "./imageCache.ts";
import { GroupKeyUnavailableError } from "./imageUploadErrors.ts";
import { ownImageKeyOwner, readOwnImageKey, storeOwnImageKey } from "./ownImageKey.ts";
import { createPersonalDataOpener } from "./personalData.ts";

const wrapUnderLatestEpoch = async ({
  device,
  fileName,
  groupId,
  imageKey,
  kind,
  ownerId,
}: {
  device: EpochKeyDevice;
  fileName: string;
  groupId: string;
  imageKey: ImageKeyMaterial;
  kind: ImageKeyKind;
  ownerId: string;
}) => {
  const latest = await trpcClient.groupEpoch.getLatest.query({ groupId });
  if (!latest) throw new GroupKeyUnavailableError();
  const epochKey = await resolveEpochKey({ device, epochId: latest.epochId, groupId });
  if (!epochKey) throw new GroupKeyUnavailableError();
  return encryptImageKey({
    epochId: latest.epochId,
    epochKey,
    fileName,
    groupId,
    imageKey,
    kind,
    ownerId,
    senderDeviceId: device.deviceId,
  });
};

const retryImageKeyWrite = async <T>({
  attempt,
  groupId,
}: {
  attempt: () => Promise<T>;
  groupId: string | null;
}) => {
  for (let tries = 1; ; tries += 1) {
    const result = await tryCatch(attempt());
    if (!result.error) return result.data;
    const reason = errorReason(result.error);
    if (tries >= 3) throw result.error;
    if (reason === "DEVICE_NOT_REGISTERED") {
      await ensureDeviceKeyRegistration({ linkSession: true });
    } else if (reason === "EPOCH_ROTATION_PENDING" && groupId) {
      await rotateGroupEpochIfRequired(groupId);
    } else if (reason !== "EPOCH_NOT_LATEST") {
      throw result.error;
    }
  }
};

const sealOwnImageKey = async ({
  fileName,
  imageKey,
  userId,
}: {
  fileName: string;
  imageKey: ImageKeyMaterial;
  userId: string;
}) => {
  const current = await tryCatch(getCurrentHistoryKeyState(userId));
  if (current.data?.status !== "held") return null;
  const historyKey = current.data.historyKey;
  const sealed = await tryCatch(
    Promise.resolve().then(() => sealProfileImageKey({ fileName, historyKey, imageKey, userId })),
  );
  return sealed.data ?? null;
};

export const confirmProfileImage = async ({
  fileName,
  imageKey,
  userId,
}: {
  fileName: string;
  imageKey: ImageKeyMaterial;
  userId: string;
}) => {
  const owner = ownImageKeyOwner(userId);
  const sealed = await sealOwnImageKey({ fileName, imageKey, userId });
  const confirmed = await retryImageKeyWrite({
    groupId: null,
    attempt: async () => {
      const [device, groups] = await Promise.all([
        ensureDeviceKeyRegistration(),
        trpcClient.groupMembership.list.query(),
      ]);
      const wraps = await Promise.all(
        groups.map(async ({ id: groupId }) => {
          const wrapped = await tryCatch(
            wrapUnderLatestEpoch({
              device,
              fileName,
              groupId,
              imageKey,
              kind: "profile-image-key",
              ownerId: userId,
            }),
          );
          return wrapped.data ? [{ groupId, ...wrapped.data }] : [];
        }),
      );
      return trpcClient.account.confirmProfileImageUpload.mutate({
        wraps: wraps.flat(),
        ...(sealed ? { sealed } : {}),
      });
    },
  });
  await tryCatch(storeOwnImageKey({ fileName, imageKey, owner, userId }));
  return confirmed;
};

export const confirmGroupImage = ({
  expectedFileName,
  fileName,
  groupId,
  imageKey,
}: {
  expectedFileName?: string | null;
  fileName: string;
  groupId: string;
  imageKey: ImageKeyMaterial;
}) =>
  retryImageKeyWrite({
    groupId,
    attempt: async () => {
      const device = await ensureDeviceKeyRegistration();
      const key = await wrapUnderLatestEpoch({
        device,
        fileName,
        groupId,
        imageKey,
        kind: "group-image-key",
        ownerId: groupId,
      });
      return trpcClient.groupSettings.confirmGroupImageUpload.mutate({
        groupId,
        key,
        ...(expectedFileName === undefined ? {} : { expectedFileName }),
      });
    },
  });

const unwrapOwnImageKeyFromGroups = async ({
  fileName,
  groups,
  userId,
}: {
  fileName: string;
  groups: () => Promise<RouterOutputs["groupMembership"]["list"]>;
  userId: string;
}) => {
  const list = await tryCatch(groups());
  for (const group of list.data ?? []) {
    const me = group.members.find((member) => member.userId === userId);
    const imageKey = me?.imageKey;
    if (!imageKey || imageFileNameFromUrl(me?.image) !== fileName) continue;
    const epochKey = await tryCatch(
      resolveEpochKey({ epochId: imageKey.epochId, groupId: group.id }),
    );
    const resolved = epochKey.data;
    if (!resolved) continue;
    const opened = await tryCatch(
      Promise.resolve().then(() =>
        decryptImageKey({
          encryptedKey: imageKey,
          epochKey: resolved,
          fileName,
          groupId: group.id,
          kind: "profile-image-key",
          ownerId: userId,
        }),
      ),
    );
    if (opened.data) return opened.data;
  }
  return null;
};

export const getOwnImageKey = async ({
  fileName,
  groups = () => trpcClient.groupMembership.list.query(),
  sealed,
  userId,
}: {
  fileName: string;
  groups?: () => Promise<RouterOutputs["groupMembership"]["list"]>;
  sealed: string | null;
  userId: string;
}) => {
  const owner = ownImageKeyOwner(userId);
  const stored = await tryCatch(readOwnImageKey({ fileName, userId }));
  if (stored.data) return stored.data;
  const opened = sealed
    ? await tryCatch(
        createPersonalDataOpener(userId)({
          purpose: "profile-image",
          binding: [userId, fileName],
          sealed,
        }),
      )
    : null;
  const imageKey = opened?.data
    ? new ImageKeyMaterial(decodeBase64(opened.data))
    : await unwrapOwnImageKeyFromGroups({ fileName, groups, userId });
  if (!imageKey) return null;
  await tryCatch(storeOwnImageKey({ fileName, imageKey, owner, userId }));
  return imageKey;
};

export const storeOwnImageKeyInGroup = async (groupId: string) => {
  const store = async () => {
    const session = await authClient.getSession();
    const user = session.data?.user;
    const fileName = imageFileNameFromUrl(user?.image);
    if (!user || !fileName) return false;
    const imageKey = await getOwnImageKey({
      fileName,
      sealed: user.imageKeySealed ?? null,
      userId: user.id,
    });
    if (!imageKey) return false;
    await retryImageKeyWrite({
      groupId,
      attempt: async () => {
        const device = await ensureDeviceKeyRegistration();
        const key = await wrapUnderLatestEpoch({
          device,
          fileName,
          groupId,
          imageKey,
          kind: "profile-image-key",
          ownerId: user.id,
        });
        return trpcClient.groupImageKeys.store.mutate({ fileName, groupId, key });
      },
    });
    return true;
  };
  const first = await tryCatch(store());
  if (!first.error) return first.data;
  if (errorReason(first.error) !== "IMAGE_CHANGED") throw first.error;
  return store();
};
