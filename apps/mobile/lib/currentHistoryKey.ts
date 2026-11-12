import { getHistoryPublicKey } from "@openbeacon/encryption";
import { trpcClient } from "./api.ts";
import { deleteStoredHistoryKeys, getStoredHistoryKey } from "./historyKeys.ts";
import { storage } from "./storage.ts";

export const getUnpublishedHistoryKeyName = (userId: string) =>
  `encryption.history.unpublished.${userId}`;

const forgetLostFirstHistoryKey = async ({
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

export const checkStoredHistoryKey = async ({
  publicKey,
  userId,
  version,
}: {
  publicKey: string;
  userId: string;
  version: number;
}) => {
  const stored = await getStoredHistoryKey({ userId, version });
  if (!stored) return { status: "missing" as const, version };
  if (getHistoryPublicKey(stored) !== publicKey) return { status: "mismatch" as const, version };
  return { historyKey: { publicKey, version }, status: "held" as const };
};

export const getCurrentHistoryKeyState = async (userId: string) => {
  const { currentHistoryKey, recoveryKey } = await trpcClient.accountRecovery.status.query();
  if (!currentHistoryKey) return { status: "none" as const };
  let state = await checkStoredHistoryKey({ ...currentHistoryKey, userId });
  if (state.status === "mismatch" && currentHistoryKey.version === 1) {
    if (await forgetLostFirstHistoryKey({ publicKey: currentHistoryKey.publicKey, userId })) {
      state = { status: "missing", version: 1 };
    }
  }
  if (state.status === "missing" && !recoveryKey) {
    return { status: "onOtherDevice" as const, version: state.version };
  }
  return state;
};
