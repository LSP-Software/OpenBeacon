import { decryptImage, decryptImageKey, type ImageKeyMaterial } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { type RouterOutputs, trpcClient } from "./api.ts";
import { baseUrl } from "./currentServer.ts";
import { downloadEncryptedImage } from "./decryptedImages.ts";
import { errorReason } from "./errorReason.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { uploadEncryptedImage } from "./image-upload.ts";
import { cachedImageUri, imageFileNameFromUrl, readCachedImage } from "./imageCache.ts";
import { confirmGroupImage, getOwnImageKey, storeOwnImageKeyInGroup } from "./imageKeys.ts";
import type { StoredImageKey } from "./imageKeyTypes.ts";
import { storage } from "./storage.ts";

const RETRY_AFTER_MS = 15 * 60_000;
const GROUP_IMAGE_REPAIR_EVERY_MS = 24 * 60 * 60_000;

const attempts = new Map<string, { at: number; signature: string }>();
let running: Promise<boolean> | null = null;

type CheckInput = {
  groups: RouterOutputs["groupMembership"]["list"];
  user: { id: string; image?: string | null; imageKeySealed?: string | null };
};

let pending: CheckInput | null = null;
let currentUserId: string | null = null;

const unsettled = { settled: false, repaired: false };

const storageKey = (name: string, userId: string, groupId: string) =>
  `imageKeys.${name}.${JSON.stringify([baseUrl, userId, groupId])}`;

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

const unwrapStoredKey = async ({
  fileName,
  groupId,
  imageKey,
  kind,
  ownerId,
}: {
  fileName: string;
  groupId: string;
  imageKey: StoredImageKey;
  kind: "group-image-key" | "profile-image-key";
  ownerId: string;
}) => {
  const epochKey = await resolveEpochKey({ epochId: imageKey.epochId, groupId });
  if (!epochKey) return { status: "unknown" } as const;
  const unwrapped = await tryCatch(
    Promise.resolve().then(() =>
      decryptImageKey({ encryptedKey: imageKey, epochKey, fileName, groupId, kind, ownerId }),
    ),
  );
  return unwrapped.error
    ? ({ status: "broken" } as const)
    : ({ status: "ok", key: unwrapped.data } as const);
};

const checkOwnKey = async ({
  fileName,
  groupId,
  imageKey,
  ownKey,
  userId,
}: {
  fileName: string;
  groupId: string;
  imageKey: StoredImageKey | null;
  ownKey: ImageKeyMaterial;
  userId: string;
}) => {
  if (imageKey) {
    const stored = await unwrapStoredKey({
      fileName,
      groupId,
      imageKey,
      kind: "profile-image-key",
      ownerId: userId,
    });
    if (stored.status === "ok" && sameBytes(stored.key.expose(), ownKey.expose())) {
      return { settled: true, repaired: false };
    }
  }
  const repaired = await storeOwnImageKeyInGroup(groupId);
  return { settled: repaired, repaired };
};

const checkGroupKey = async ({
  fileName,
  groupId,
  imageKey,
  url,
  userId,
}: {
  fileName: string;
  groupId: string;
  imageKey: StoredImageKey;
  url: string;
  userId: string;
}) => {
  const repairKey = storageKey("groupImageRepairAt", userId, groupId);
  const repairedAt = storage.getNumber(repairKey) ?? 0;
  if (!cachedImageUri(fileName) || Date.now() - repairedAt < GROUP_IMAGE_REPAIR_EVERY_MS) {
    return unsettled;
  }
  const stored = await unwrapStoredKey({
    fileName,
    groupId,
    imageKey,
    kind: "group-image-key",
    ownerId: groupId,
  });
  if (stored.status === "unknown") return unsettled;
  if (stored.status === "ok") {
    const blob = await downloadEncryptedImage(url);
    const opened = await tryCatch(
      Promise.resolve().then(() =>
        decryptImage({ blob, fileName, key: stored.key, ownerId: groupId, purpose: "group-image" }),
      ),
    );
    if (!opened.error) return { settled: true, repaired: false };
  }
  const latest = (await trpcClient.groupMembership.list.query()).find(({ id }) => id === groupId);
  const role = latest?.members.find((member) => member.userId === userId)?.role;
  if (
    latest?.image !== url ||
    latest.imageKey?.ciphertext !== imageKey.ciphertext ||
    (role !== "OWNER" && role !== "ADMIN")
  ) {
    return unsettled;
  }
  const plain = await readCachedImage(fileName);
  if (!plain) return unsettled;
  storage.set(repairKey, Date.now());
  const uploaded = await tryCatch(
    uploadEncryptedImage({
      bytes: plain,
      ownerId: groupId,
      purpose: "group-image",
      request: () => trpcClient.groupSettings.requestGroupImageUpload.mutate({ groupId }),
      presign: (input) =>
        trpcClient.groupSettings.presignGroupImageUpload.mutate({ groupId, ...input }),
      confirm: ({ fileName: newFileName, imageKey: newImageKey }) =>
        confirmGroupImage({
          expectedFileName: fileName,
          fileName: newFileName,
          groupId,
          imageKey: newImageKey,
        }),
    }),
  );
  if (errorReason(uploaded.error) === "IMAGE_CHANGED") return unsettled;
  if (uploaded.error) throw uploaded.error;
  return { settled: true, repaired: true };
};

const runCheck = async ({
  check,
  signature,
  slot,
}: {
  check: () => Promise<{ repaired: boolean; settled: boolean }>;
  signature: string;
  slot: string;
}) => {
  if (storage.getString(slot) === signature) return false;
  const previous = attempts.get(slot);
  if (previous?.signature === signature && Date.now() - previous.at < RETRY_AFTER_MS) return false;
  attempts.set(slot, { at: Date.now(), signature });
  const result = await tryCatch(check());
  if (result.error) return false;
  if (result.data.settled) storage.set(slot, signature);
  return result.data.repaired;
};

const checkAll = async ({ groups, user }: CheckInput) => {
  let repaired = false;
  const ownFileName = imageFileNameFromUrl(user.image);
  let ownKey: Promise<ImageKeyMaterial | null> | null = null;
  for (const group of groups) {
    if (currentUserId !== user.id) break;
    const me = group.members.find(({ userId }) => userId === user.id);
    if (!me) continue;
    if (ownFileName && imageFileNameFromUrl(me.image) === ownFileName) {
      repaired =
        (await runCheck({
          slot: storageKey("ownChecked", user.id, group.id),
          signature: `${ownFileName}|${me.imageKey?.ciphertext ?? ""}`,
          check: async () => {
            ownKey ??= getOwnImageKey({
              fileName: ownFileName,
              groups: async () => groups,
              sealed: user.imageKeySealed ?? null,
              userId: user.id,
            });
            const key = await ownKey;
            if (!key) return unsettled;
            return checkOwnKey({
              fileName: ownFileName,
              groupId: group.id,
              imageKey: me.imageKey,
              ownKey: key,
              userId: user.id,
            });
          },
        })) || repaired;
    }
    if (currentUserId !== user.id) break;
    const groupFileName = imageFileNameFromUrl(group.image);
    const groupImageKey = group.imageKey;
    if (
      group.image &&
      groupFileName &&
      groupImageKey &&
      (me.role === "OWNER" || me.role === "ADMIN")
    ) {
      const url = group.image;
      repaired =
        (await runCheck({
          slot: storageKey("groupChecked", user.id, group.id),
          signature: `${groupFileName}|${groupImageKey.ciphertext}`,
          check: () =>
            checkGroupKey({
              fileName: groupFileName,
              groupId: group.id,
              imageKey: groupImageKey,
              url,
              userId: user.id,
            }),
        })) || repaired;
    }
  }
  return repaired;
};

const drain = async () => {
  let repaired = false;
  for (let next = pending; next; next = pending) {
    pending = null;
    const checked = await tryCatch(checkAll(next));
    repaired = Boolean(checked.data) || repaired;
  }
  running = null;
  return repaired;
};

export const checkImageKeys = (input: CheckInput) => {
  pending = input;
  currentUserId = input.user.id;
  running ??= drain();
  return running;
};

export const resetImageKeyCheck = () => {
  pending = null;
  currentUserId = null;
  attempts.clear();
};
