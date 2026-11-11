import { createHistoryKeyPair, getHistoryPublicKey } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { deleteStoredHistoryKeys, getStoredHistoryKey, storeHistoryKey } from "./historyKeys.ts";
import { storage } from "./storage.ts";

const getUnpublishedHistoryKeyName = (userId: string) => `encryption.history.unpublished.${userId}`;

export const KEY_NOT_SAVED_MESSAGE =
  "Unable to save your keys on this phone. Unlock your phone and try again.";

export const createHistoryKey = async (userId: string) => {
  const historyKey = createHistoryKeyPair();
  const unpublishedName = getUnpublishedHistoryKeyName(userId);
  storage.set(unpublishedName, historyKey.publicKey);
  const stored = await tryCatch(
    storeHistoryKey({ privateKey: historyKey.privateKey, userId, version: 1 }),
  );
  if (stored.error) {
    storage.remove(unpublishedName);
    throw new Error(KEY_NOT_SAVED_MESSAGE);
  }
  const created = await tryCatch(
    trpcClient.accountHistory.create.mutate({
      algorithm: historyKey.algorithm,
      id: globalThis.crypto.randomUUID(),
      publicKey: historyKey.publicKey,
    }),
  );
  if (!created.error) {
    storage.remove(unpublishedName);
    return true;
  }
  const status = await tryCatch(trpcClient.accountRecovery.status.query());
  if (status.error) throw created.error;
  const published = status.data.currentHistoryKey?.publicKey === historyKey.publicKey;
  if (!published) await deleteStoredHistoryKeys({ userId, upToVersion: 1 });
  storage.remove(unpublishedName);
  if (published) return true;
  if (status.data.currentHistoryKey) return false;
  throw created.error;
};

export const createHistoryKeyIfMissing = async (userId: string) => {
  const { currentHistoryKey } = await trpcClient.accountRecovery.status.query();
  if (currentHistoryKey) return false;
  return createHistoryKey(userId);
};

export const forgetLostFirstHistoryKey = async ({
  publicKey,
  userId,
}: {
  publicKey: string;
  userId: string;
}) => {
  const unpublished = storage.getString(getUnpublishedHistoryKeyName(userId));
  if (!unpublished) return false;
  const stored = await getStoredHistoryKey({ userId, version: 1 });
  if (unpublished === publicKey || !stored || getHistoryPublicKey(stored) !== unpublished) {
    storage.remove(getUnpublishedHistoryKeyName(userId));
    return false;
  }
  await deleteStoredHistoryKeys({ userId, upToVersion: 1 });
  storage.remove(getUnpublishedHistoryKeyName(userId));
  return true;
};
