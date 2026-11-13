import { decodeBase64, encodeBase64 } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import * as SecureStore from "expo-secure-store";
import { getSecureStoreOptions } from "./secureStoreOptions.ts";

const getSavedDeviceLinkName = ({ deviceId, userId }: { deviceId: string; userId: string }) =>
  `encryption.deviceLink.${userId}.${deviceId}`;

export const saveDeviceLink = async ({
  linkId,
  psk,
  ...device
}: {
  deviceId: string;
  linkId: string;
  psk: Uint8Array;
  userId: string;
}) =>
  SecureStore.setItemAsync(
    getSavedDeviceLinkName(device),
    JSON.stringify({ linkId, psk: encodeBase64(psk) }),
    getSecureStoreOptions(),
  );

export const readSavedDeviceLink = async (device: { deviceId: string; userId: string }) => {
  const stored = await SecureStore.getItemAsync(
    getSavedDeviceLinkName(device),
    getSecureStoreOptions(),
  );
  if (!stored) return null;
  const parsed = await tryCatch(
    Promise.resolve().then(() => {
      const { linkId, psk }: { linkId?: unknown; psk?: unknown } = JSON.parse(stored);
      if (typeof linkId !== "string" || typeof psk !== "string") return null;
      return { linkId, psk: decodeBase64(psk) };
    }),
  );
  return parsed.data ?? null;
};

export const deleteSavedDeviceLink = async (device: { deviceId: string; userId: string }) =>
  SecureStore.deleteItemAsync(getSavedDeviceLinkName(device), getSecureStoreOptions());
