import { createHistoryKeyPair } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { getUnpublishedHistoryKeyName } from "./currentHistoryKey.ts";
import { deleteStoredHistoryKeys, storeHistoryKey } from "./historyKeys.ts";
import { secretOwner } from "./secretStorage.ts";
import { storage } from "./storage.ts";

export const KEY_NOT_SAVED_MESSAGE =
  "Unable to save your keys on this phone. Unlock your phone and try again.";

const publishFirstHistoryKey = async (userId: string, owner: ReturnType<typeof secretOwner>) => {
  const historyKey = createHistoryKeyPair();
  const unpublishedName = getUnpublishedHistoryKeyName(userId);
  storage.set(unpublishedName, historyKey.publicKey);
  const stored = await tryCatch(
    storeHistoryKey({ privateKey: historyKey.privateKey, owner, userId, version: 1 }),
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

const pendingCreates = new Map<string, Promise<boolean>>();

export const createHistoryKey = (userId: string, owner = secretOwner(userId)) => {
  const pending = pendingCreates.get(userId);
  if (pending) return pending;
  const task = publishFirstHistoryKey(userId, owner).finally(() => {
    pendingCreates.delete(userId);
  });
  pendingCreates.set(userId, task);
  return task;
};

export const createHistoryKeyIfMissing = async (userId: string) => {
  const { currentHistoryKey } = await trpcClient.accountRecovery.status.query();
  if (currentHistoryKey) return false;
  return createHistoryKey(userId);
};
