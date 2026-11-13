import { decodeBase64, encodeBase64, HistoryPrivateKeyMaterial } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import {
  deleteSecret,
  readSecret,
  secretOwner,
  withSecretDeadline,
  writeSecret,
} from "./secretStorage.ts";

const getHistoryKeyName = ({ userId, version }: { userId: string; version: number }) =>
  `encryption.history.${userId}.${version}`;

export const getStoredHistoryKey = async (input: { userId: string; version: number }) => {
  const stored = await readSecret(getHistoryKeyName(input));
  return stored ? new HistoryPrivateKeyMaterial(decodeBase64(stored)) : null;
};

export const storeHistoryKey = async ({
  privateKey,
  owner,
  ...input
}: {
  privateKey: HistoryPrivateKeyMaterial;
  owner?: ReturnType<typeof secretOwner>;
  userId: string;
  version: number;
}) =>
  withSecretDeadline(
    writeSecret(
      owner ?? secretOwner(input.userId),
      getHistoryKeyName(input),
      encodeBase64(privateKey.expose()),
    ),
  );

export const deleteStoredHistoryKeys = async ({
  userId,
  upToVersion,
}: {
  userId: string;
  upToVersion: number;
}) => {
  let firstError: Error | null = null;
  for (let version = 1; version <= upToVersion; version += 1) {
    const deleted = await tryCatch(deleteSecret(getHistoryKeyName({ userId, version })));
    firstError ??= deleted.error;
  }
  if (firstError) throw firstError;
};
