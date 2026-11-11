import { decodeBase64, encodeBase64, HistoryPrivateKeyMaterial } from "@openbeacon/encryption";
import * as SecureStore from "expo-secure-store";

const getHistoryKeyName = ({ userId, version }: { userId: string; version: number }) =>
  `encryption.history.${userId}.${version}`;

const getSecureStoreOptions = () => ({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

export const getStoredHistoryKey = async (input: { userId: string; version: number }) => {
  const stored = await SecureStore.getItemAsync(getHistoryKeyName(input), getSecureStoreOptions());
  return stored ? new HistoryPrivateKeyMaterial(decodeBase64(stored)) : null;
};

export const storeHistoryKey = async ({
  privateKey,
  ...input
}: {
  privateKey: HistoryPrivateKeyMaterial;
  userId: string;
  version: number;
}) =>
  SecureStore.setItemAsync(
    getHistoryKeyName(input),
    encodeBase64(privateKey.expose()),
    getSecureStoreOptions(),
  );

export const deleteStoredHistoryKeys = async ({
  userId,
  upToVersion,
}: {
  userId: string;
  upToVersion: number;
}) => {
  for (let version = 1; version <= upToVersion; version += 1) {
    await SecureStore.deleteItemAsync(
      getHistoryKeyName({ userId, version }),
      getSecureStoreOptions(),
    );
  }
};
