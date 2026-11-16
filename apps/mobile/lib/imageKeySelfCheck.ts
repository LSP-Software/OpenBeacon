import { decryptImage, decryptImageKey, type ImageKeyMaterial } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { type RouterOutputs, trpcClient } from "./api.ts";
import { downloadEncryptedImage } from "./decryptedImages.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { uploadEncryptedImage } from "./image-upload.ts";
import { imageFileNameFromUrl, readCachedImage } from "./imageCache.ts";
import { confirmGroupImage, getOwnImageKey, storeOwnImageKeyInGroup } from "./imageKeys.ts";

type StoredImageKey = NonNullable<RouterOutputs["groupMembership"]["list"][number]["imageKey"]>;

const RETRY_AFTER_MS = 15 * 60_000;

const checks = new Map<string, { at: number; settled: boolean }>();
let running: Promise<boolean> | null = null;

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
    if (stored.status === "unknown") return { settled: false, repaired: false };
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
}: {
  fileName: string;
  groupId: string;
  imageKey: StoredImageKey;
  url: string;
}) => {
  const plain = await readCachedImage(fileName);
  if (!plain) return { settled: false, repaired: false };
  const stored = await unwrapStoredKey({
    fileName,
    groupId,
    imageKey,
    kind: "group-image-key",
    ownerId: groupId,
  });
  if (stored.status === "unknown") return { settled: false, repaired: false };
  if (stored.status === "ok") {
    const blob = await downloadEncryptedImage(url);
    const opened = await tryCatch(
      Promise.resolve().then(() =>
        decryptImage({ blob, fileName, key: stored.key, ownerId: groupId, purpose: "group-image" }),
      ),
    );
    if (!opened.error) return { settled: true, repaired: false };
  }
  await uploadEncryptedImage({
    bytes: plain,
    ownerId: groupId,
    purpose: "group-image",
    request: () => trpcClient.groupSettings.requestGroupImageUpload.mutate({ groupId }),
    presign: (input) =>
      trpcClient.groupSettings.presignGroupImageUpload.mutate({ groupId, ...input }),
    confirm: ({ fileName: newFileName, imageKey: newImageKey }) =>
      confirmGroupImage({ fileName: newFileName, groupId, imageKey: newImageKey }),
  });
  return { settled: true, repaired: true };
};

const runCheck = async (
  checkKey: string,
  check: () => Promise<{ repaired: boolean; settled: boolean }>,
) => {
  const previous = checks.get(checkKey);
  if (previous && (previous.settled || Date.now() - previous.at < RETRY_AFTER_MS)) return false;
  checks.set(checkKey, { at: Date.now(), settled: false });
  const result = await tryCatch(check());
  if (result.error) return false;
  checks.set(checkKey, { at: Date.now(), settled: result.data.settled });
  return result.data.repaired;
};

const checkAll = async ({
  groups,
  user,
}: {
  groups: RouterOutputs["groupMembership"]["list"];
  user: { id: string; image?: string | null; imageKeySealed?: string | null };
}) => {
  let repaired = false;
  const ownFileName = imageFileNameFromUrl(user.image);
  let ownKey: Promise<ImageKeyMaterial | null> | null = null;
  for (const group of groups) {
    const me = group.members.find(({ userId }) => userId === user.id);
    if (!me) continue;
    if (ownFileName && imageFileNameFromUrl(me.image) === ownFileName) {
      repaired =
        (await runCheck(
          `${user.id}|own|${group.id}|${ownFileName}|${me.imageKey?.ciphertext ?? ""}`,
          async () => {
            ownKey ??= getOwnImageKey({
              fileName: ownFileName,
              sealed: user.imageKeySealed ?? null,
              userId: user.id,
            });
            const key = await ownKey;
            if (!key) return { settled: false, repaired: false };
            return checkOwnKey({
              fileName: ownFileName,
              groupId: group.id,
              imageKey: me.imageKey,
              ownKey: key,
              userId: user.id,
            });
          },
        )) || repaired;
    }
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
        (await runCheck(
          `${user.id}|group|${group.id}|${groupFileName}|${groupImageKey.ciphertext}`,
          () =>
            checkGroupKey({
              fileName: groupFileName,
              groupId: group.id,
              imageKey: groupImageKey,
              url,
            }),
        )) || repaired;
    }
  }
  return repaired;
};

export const checkImageKeys = (input: Parameters<typeof checkAll>[0]) => {
  running ??= checkAll(input).finally(() => {
    running = null;
  });
  return running;
};
