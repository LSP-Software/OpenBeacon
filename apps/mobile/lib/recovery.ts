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
import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { trpcClient } from "./api.ts";
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

export const setUpRecoveryPhrase = async (phrase: RecoveryPhrase) => {
  const device = await ensureDeviceKeyRegistration();
  const recoveryKey = deriveRecoveryKeyPair(phrase);
  const historyKey = createHistoryKeyPair();
  const version = 1;
  const result = await tryCatch(
    trpcClient.accountRecovery.setup.mutate({
      historyKey: {
        algorithm: historyKey.algorithm,
        escrow: sealHistoryKeyEscrow({
          historyPrivateKey: historyKey.privateKey,
          recoveryPublicKey: recoveryKey.publicKey,
          userId: device.userId,
          version,
        }),
        id: globalThis.crypto.randomUUID(),
        publicKey: historyKey.publicKey,
        version,
      },
      recoveryKey: {
        algorithm: recoveryKey.algorithm,
        derivationVersion: RECOVERY_KEY_DERIVATION_VERSION,
        publicKey: recoveryKey.publicKey,
      },
    }),
  );
  if (result.error instanceof TRPCClientError && result.error.data?.code === "CONFLICT")
    return { status: "conflict" as const };
  if (result.error) throw result.error;
  await storeHistoryKey({ privateKey: historyKey.privateKey, userId: device.userId, version });
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
    if (storedHistoryKey && getHistoryPublicKey(storedHistoryKey) !== historyKey.publicKey) {
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

export const findMissingHistoryKey = async () => {
  const status = await trpcClient.accountRecovery.status.query();
  if (!status.recoveryKey || !status.currentHistoryKey) return null;
  const { userId } = await ensureDeviceKeyRegistration();
  const { version } = status.currentHistoryKey;
  return (await getStoredHistoryKey({ userId, version })) ? null : { userId, version };
};

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
  if (stored.error) {
    throw new Error("Unable to save your keys on this phone. Unlock your phone and try again.");
  }
  return { userId: device.userId, versions };
};
