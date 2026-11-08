import { getHistoryPublicKey } from "@openbeacon/encryption";
import { trpcClient } from "./api.ts";
import { getStoredHistoryKey } from "./historyKeys.ts";

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
  if (!recoveryKey || !currentHistoryKey) return { status: "none" as const };
  return checkStoredHistoryKey({ ...currentHistoryKey, userId });
};
