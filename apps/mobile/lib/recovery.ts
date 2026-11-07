import {
  createHistoryKeyPair,
  type DevicePrivateKeyMaterial,
  deriveRecoveryKeyPair,
  getHistoryPublicKey,
  RECOVERY_KEY_DERIVATION_VERSION,
  type RecoveryPhrase,
  sealHistoryKeyEscrow,
  unwrapEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { trpcClient } from "./api.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";
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
  device: { deviceId: string; privateKey: DevicePrivateKeyMaterial; userId: string };
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
      if (deviceWrap.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) continue;
      const epochKey = await tryCatch(
        Promise.resolve().then(() =>
          unwrapEpochKey({
            recipientDeviceId: device.deviceId,
            recipientPrivateKey: device.privateKey,
            wrappedEpochKey: { ...deviceWrap, algorithm: WRAPPED_EPOCH_KEY_ALGORITHM, epochId },
          }),
        ),
      );
      if (epochKey.error) continue;
      wraps.push(
        wrapEpochKeyForHistoryKey({
          epochId,
          epochKey: epochKey.data,
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
