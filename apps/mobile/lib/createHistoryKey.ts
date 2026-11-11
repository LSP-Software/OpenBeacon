import { createHistoryKeyPair } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { trpcClient } from "./api.ts";
import { deleteStoredHistoryKeys, storeHistoryKey } from "./historyKeys.ts";

export const KEY_NOT_SAVED_MESSAGE =
  "Unable to save your keys on this phone. Unlock your phone and try again.";

export const createHistoryKey = async (userId: string) => {
  const historyKey = createHistoryKeyPair();
  const stored = await tryCatch(
    storeHistoryKey({ privateKey: historyKey.privateKey, userId, version: 1 }),
  );
  if (stored.error) throw new Error(KEY_NOT_SAVED_MESSAGE);
  const created = await tryCatch(
    trpcClient.accountHistory.create.mutate({
      algorithm: historyKey.algorithm,
      id: globalThis.crypto.randomUUID(),
      publicKey: historyKey.publicKey,
    }),
  );
  if (!created.error) return true;
  const status = await tryCatch(trpcClient.accountRecovery.status.query());
  if (status.error) throw created.error;
  if (status.data.currentHistoryKey?.publicKey === historyKey.publicKey) return true;
  await deleteStoredHistoryKeys({ userId, upToVersion: 1 });
  if (status.data.currentHistoryKey) return false;
  throw created.error;
};

export const createHistoryKeyIfMissing = async (userId: string) => {
  const { currentHistoryKey } = await trpcClient.accountRecovery.status.query();
  if (currentHistoryKey) return false;
  return createHistoryKey(userId);
};
