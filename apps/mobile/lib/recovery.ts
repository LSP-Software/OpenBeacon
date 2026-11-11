import {
  createHistoryKeyPair,
  deriveRecoveryKeyPair,
  getHistoryPublicKey,
  HISTORY_ESCROW_ALGORITHM,
  openHistoryKeyEscrow,
  RECOVERY_KEY_DERIVATION_VERSION,
  type RecoveryPhrase,
  sealHistoryKeyEscrow,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import type { resetAccountRecoverySchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import type z from "zod";
import { trpcClient } from "./api.ts";
import { createHistoryKey, KEY_NOT_SAVED_MESSAGE } from "./createHistoryKey.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
import { type EpochKeyDevice, unwrapDeviceWrap } from "./epochKeys.ts";
import { getStoredHistoryKey, storeHistoryKey } from "./historyKeys.ts";

export const pickConfirmationIndexes = () => {
  const indexes = new Set<number>();
  const random = new Uint32Array(1);
  while (indexes.size < 3) {
    globalThis.crypto.getRandomValues(random);
    indexes.add((random[0] ?? 0) % 12);
  }
  return [...indexes].sort((a, b) => a - b);
};

export const confirmsRecoveryPhrase = ({
  answers,
  phrase,
}: {
  answers: { index: number; word: string }[];
  phrase: RecoveryPhrase;
}) => {
  const words = phrase.words();
  return (
    answers.length > 0 &&
    answers.every(({ index, word }) => word.normalize("NFKD").trim().toLowerCase() === words[index])
  );
};

const hasTrpcCode = (error: unknown, code: string) =>
  error instanceof TRPCClientError && error.data?.code === code;

const recoveryKeyInput = (recoveryKey: ReturnType<typeof deriveRecoveryKeyPair>) =>
  ({
    algorithm: recoveryKey.algorithm,
    derivationVersion: RECOVERY_KEY_DERIVATION_VERSION,
    publicKey: recoveryKey.publicKey,
  }) as const;

const createRecoveryKeys = ({
  phrase,
  userId,
  version,
}: {
  phrase: RecoveryPhrase;
  userId: string;
  version: number;
}) => {
  const recoveryKey = deriveRecoveryKeyPair(phrase);
  const historyKey = createHistoryKeyPair();
  const input: Pick<z.infer<typeof resetAccountRecoverySchema>, "historyKey" | "recoveryKey"> = {
    historyKey: {
      algorithm: historyKey.algorithm,
      escrow: sealHistoryKeyEscrow({
        historyPrivateKey: historyKey.privateKey,
        recoveryPrivateKey: recoveryKey.privateKey,
        userId,
        version,
      }),
      id: globalThis.crypto.randomUUID(),
      publicKey: historyKey.publicKey,
      version,
    },
    recoveryKey: recoveryKeyInput(recoveryKey),
  };
  return { historyPrivateKey: historyKey.privateKey, input };
};

export const HISTORY_KEY_ON_OTHER_DEVICE_MESSAGE =
  "This phone doesn't have your account's history key yet. Set up your recovery phrase on your other phone.";
export const SETUP_KEYS_MISMATCH_MESSAGE =
  "This phone's saved keys don't match your account, so your phrase wasn't set up.";

const sealEscrowsForHeldKeys = async ({
  historyKeys,
  messages,
  recoveryKey,
  userId,
}: {
  historyKeys: { publicKey: string; version: number }[];
  messages: { missing: string; mismatch: string };
  recoveryKey: ReturnType<typeof deriveRecoveryKeyPair>;
  userId: string;
}) => {
  const escrows = [];
  for (const { publicKey, version } of historyKeys) {
    const historyPrivateKey = await getStoredHistoryKey({ userId, version });
    if (!historyPrivateKey) throw new Error(messages.missing);
    if (getHistoryPublicKey(historyPrivateKey) !== publicKey) throw new Error(messages.mismatch);
    escrows.push({
      ...sealHistoryKeyEscrow({
        historyPrivateKey,
        recoveryPrivateKey: recoveryKey.privateKey,
        userId,
        version,
      }),
      version,
    });
  }
  return escrows;
};

export const setUpRecoveryPhrase = async (phrase: RecoveryPhrase) => {
  const device = await ensureDeviceKeyRegistration();
  const recoveryKey = deriveRecoveryKeyPair(phrase);
  let status = await trpcClient.accountRecovery.status.query();
  if (!status.recoveryKey && status.historyKeys.length === 0) {
    await createHistoryKey(device.userId);
    status = await trpcClient.accountRecovery.status.query();
  }
  if (status.recoveryKey) {
    if (status.recoveryKey.publicKey !== recoveryKey.publicKey) {
      return { status: "conflict" as const };
    }
    await restoreFromRecoveryPhrase(phrase);
    return { device, status: "created" as const };
  }
  const escrows = await sealEscrowsForHeldKeys({
    historyKeys: status.historyKeys,
    messages: {
      mismatch: SETUP_KEYS_MISMATCH_MESSAGE,
      missing: HISTORY_KEY_ON_OTHER_DEVICE_MESSAGE,
    },
    recoveryKey,
    userId: device.userId,
  });
  const result = await tryCatch(
    trpcClient.accountRecovery.setup.mutate({
      escrows,
      recoveryKey: recoveryKeyInput(recoveryKey),
    }),
  );
  if (hasTrpcCode(result.error, "FORBIDDEN")) return { status: "reauthenticate" as const };
  if (hasTrpcCode(result.error, "CONFLICT")) {
    const latest = await trpcClient.accountRecovery.status.query();
    if (!latest.recoveryKey) throw new Error(RECOVERY_CHANGED_MESSAGE);
    if (latest.recoveryKey.publicKey !== recoveryKey.publicKey) {
      return { status: "conflict" as const };
    }
    await restoreFromRecoveryPhrase(phrase);
    return { device, status: "created" as const };
  }
  if (result.error) throw result.error;
  return { device, status: "created" as const };
};

export const backfillHistoryWraps = async ({
  device,
  groupId,
}: {
  device: EpochKeyDevice;
  groupId: string;
}) => {
  let cursor: number | null = null;
  let wrapped = 0;
  do {
    const page = await trpcClient.groupEpoch.listHistoryBackfill.query({
      cursor,
      deviceId: device.deviceId,
      groupId,
    });
    if (!page.historyKey || page.epochs.length === 0) return wrapped;
    const historyKey = { ...page.historyKey, userId: device.userId };
    const storedHistoryKey = await getStoredHistoryKey(historyKey);
    if (!storedHistoryKey) return wrapped;
    if (getHistoryPublicKey(storedHistoryKey) !== historyKey.publicKey) {
      throw new Error("The server's history key doesn't match this device.");
    }
    const wraps = [];
    for (const { deviceWrap, epochId } of page.epochs) {
      const epochKey = await unwrapDeviceWrap({ device, deviceWrap, epochId });
      if (!epochKey) continue;
      wraps.push(
        wrapEpochKeyForHistoryKey({
          epochId,
          epochKey,
          historyKey,
          senderPrivateKey: device.privateKey,
        }),
      );
    }
    if (wraps.length > 0) {
      await trpcClient.groupEpoch.addHistoryWraps.mutate({
        deviceId: device.deviceId,
        groupId,
        historyKeyId: historyKey.id,
        wraps,
      });
      wrapped += wraps.length;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  return wrapped;
};

export const PHRASE_MISMATCH_MESSAGE = "That phrase doesn't match this account.";
export const RECOVERY_DATA_MISMATCH_MESSAGE =
  "Your account's recovery data doesn't match your phrase, so nothing was restored.";

export const restoreFromRecoveryPhrase = async (phrase: RecoveryPhrase) => {
  const device = await ensureDeviceKeyRegistration();
  const status = await trpcClient.accountRecovery.status.query();
  const recoveryKey = deriveRecoveryKeyPair(phrase);
  if (
    status.recoveryKey?.algorithm !== recoveryKey.algorithm ||
    status.recoveryKey.derivationVersion !== recoveryKey.derivationVersion ||
    status.recoveryKey.publicKey !== recoveryKey.publicKey
  ) {
    throw new Error(PHRASE_MISMATCH_MESSAGE);
  }
  const escrows = await trpcClient.accountRecovery.escrows.query();
  const versions = escrows.map(({ version }) => version).sort((a, b) => a - b);
  if (
    versions.join() !== [...status.historyKeyVersions].sort((a, b) => a - b).join() ||
    escrows.some(({ escrow }) => escrow.algorithm !== HISTORY_ESCROW_ALGORITHM)
  ) {
    throw new Error(RECOVERY_DATA_MISMATCH_MESSAGE);
  }
  const opened = await tryCatch(
    Promise.resolve().then(() =>
      escrows.map(({ escrow, publicKey, version }) => ({
        privateKey: openHistoryKeyEscrow({
          escrow: { ...escrow, algorithm: HISTORY_ESCROW_ALGORITHM },
          historyKey: { publicKey, userId: device.userId, version },
          recoveryPrivateKey: recoveryKey.privateKey,
        }),
        version,
      })),
    ),
  );
  if (opened.error) throw new Error(RECOVERY_DATA_MISMATCH_MESSAGE);
  const stored = await tryCatch(
    Promise.all(
      opened.data.map(({ privateKey, version }) =>
        storeHistoryKey({ privateKey, userId: device.userId, version }),
      ),
    ),
  );
  if (stored.error) throw new Error(KEY_NOT_SAVED_MESSAGE);
  return { userId: device.userId, versions };
};

export const MISSING_HISTORY_KEYS_MESSAGE =
  "This phone needs your current recovery phrase first. Restore it, then try again.";
export const HISTORY_KEYS_MISMATCH_MESSAGE =
  "This phone's saved keys don't match your account, so your phrase wasn't changed. Restore your current recovery phrase, then try again.";
export const RECOVERY_CHANGED_MESSAGE =
  "Your recovery phrase changed on another phone, so nothing was changed here. Go back and try again.";

export const changeRecoveryPhrase = async (phrase: RecoveryPhrase) => {
  const device = await ensureDeviceKeyRegistration();
  const currentEscrows = await trpcClient.accountRecovery.escrows.query();
  if (currentEscrows.length === 0) throw new Error(RECOVERY_CHANGED_MESSAGE);
  const recoveryKey = deriveRecoveryKeyPair(phrase);
  const escrows = await sealEscrowsForHeldKeys({
    historyKeys: currentEscrows,
    messages: { mismatch: HISTORY_KEYS_MISMATCH_MESSAGE, missing: MISSING_HISTORY_KEYS_MESSAGE },
    recoveryKey,
    userId: device.userId,
  });
  const result = await tryCatch(
    trpcClient.accountRecovery.changePhrase.mutate({
      escrows,
      recoveryKey: recoveryKeyInput(recoveryKey),
    }),
  );
  if (hasTrpcCode(result.error, "FORBIDDEN")) return { status: "reauthenticate" as const };
  if (hasTrpcCode(result.error, "CONFLICT") || hasTrpcCode(result.error, "NOT_FOUND")) {
    throw new Error(RECOVERY_CHANGED_MESSAGE);
  }
  if (result.error) throw result.error;
  return { status: "changed" as const, versions: result.data.historyKeyVersions };
};

export const requestRecoveryResetCode = async () => {
  const result = await tryCatch(trpcClient.accountRecovery.requestResetCode.mutate());
  if (hasTrpcCode(result.error, "FORBIDDEN")) return { status: "reauthenticate" as const };
  if (result.error) throw result.error;
  return { email: result.data.email, status: "sent" as const };
};

export const verifyRecoveryResetCode = async (code: string) => {
  const result = await tryCatch(trpcClient.accountRecovery.verifyResetCode.mutate({ code }));
  if (hasTrpcCode(result.error, "FORBIDDEN")) return { status: "reauthenticate" as const };
  if (hasTrpcCode(result.error, "BAD_REQUEST")) return { status: "invalidCode" as const };
  if (result.error) throw result.error;
  return { resetToken: result.data.resetToken, status: "verified" as const };
};

export const resetRecoveryPhrase = async (phrase: RecoveryPhrase, resetToken?: string) => {
  const device = await ensureDeviceKeyRegistration();
  const status = await trpcClient.accountRecovery.status.query();
  const version = (status.currentHistoryKey?.version ?? 0) + 1;
  const { historyPrivateKey, input } = createRecoveryKeys({
    phrase,
    userId: device.userId,
    version,
  });
  if (status.recoveryKey?.publicKey === input.recoveryKey.publicKey) {
    const restored = await tryCatch(restoreFromRecoveryPhrase(phrase));
    if (restored.error) return { device, status: "unsaved" as const };
    return { device, status: "reset" as const, version: version - 1 };
  }
  const result = await tryCatch(
    trpcClient.accountRecovery.reset.mutate({
      ...input,
      confirmReset: true,
      ...(resetToken ? { resetToken } : {}),
    }),
  );
  if (hasTrpcCode(result.error, "FORBIDDEN")) return { status: "reauthenticate" as const };
  if (hasTrpcCode(result.error, "PRECONDITION_FAILED")) {
    return { status: "confirmationExpired" as const };
  }
  if (hasTrpcCode(result.error, "CONFLICT") || hasTrpcCode(result.error, "NOT_FOUND")) {
    throw new Error(RECOVERY_CHANGED_MESSAGE);
  }
  if (result.error) throw result.error;
  const stored = await tryCatch(
    storeHistoryKey({ privateKey: historyPrivateKey, userId: device.userId, version }),
  );
  if (stored.error) return { device, status: "unsaved" as const };
  return { device, status: "reset" as const, version };
};

export const backfillEveryGroup = async ({
  device,
  onProgress,
}: {
  device: EpochKeyDevice;
  onProgress: (progress: { done: number; failed: number; total: number }) => void;
}) => {
  const groups = await tryCatch(trpcClient.groupMembership.list.query());
  const groupIds = groups.data?.map(({ id }) => id) ?? [];
  const progress = { done: 0, failed: groups.error ? 1 : 0, total: groupIds.length };
  onProgress({ ...progress });
  for (const groupId of groupIds) {
    const backfill = await tryCatch(backfillHistoryWraps({ device, groupId }));
    progress.done += 1;
    if (backfill.error) progress.failed += 1;
    onProgress({ ...progress });
  }
  return progress;
};
