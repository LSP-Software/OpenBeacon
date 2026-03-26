import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
  decodeBase64,
  encodeBase64,
} from "@openbeacon/encryption";
import * as SecureStore from "expo-secure-store";
import { trpcClient } from "./api.ts";
import { storage } from "./storage.ts";

const DEVICE_ID_KEY = "encryption.device.id";
const DEVICE_PUBLIC_KEY_KEY = "encryption.device.publicKey";
const DEVICE_PRIVATE_KEY_KEY = "encryption.device.privateKey";

const createLocalId = (prefix: string) => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

const getSecureStoreOptions = () => ({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

export const getStoredDeviceKeyContext = async () => {
  const deviceId = storage.getString(DEVICE_ID_KEY);
  const publicKey = storage.getString(DEVICE_PUBLIC_KEY_KEY);
  const privateKey = await SecureStore.getItemAsync(
    DEVICE_PRIVATE_KEY_KEY,
    getSecureStoreOptions(),
  );

  if (!deviceId || !publicKey || !privateKey) {
    return null;
  }

  return {
    algorithm: DEVICE_KEY_ALGORITHM,
    deviceId,
    privateKey: new DevicePrivateKeyMaterial(decodeBase64(privateKey)),
    publicKey,
  };
};

export const getOrCreateDeviceKeyContext = async () => {
  const existingContext = await getStoredDeviceKeyContext();

  if (existingContext) {
    return existingContext;
  }

  const deviceKeyPair = createDeviceKeyPair();
  const deviceId = createLocalId("device");

  await SecureStore.setItemAsync(
    DEVICE_PRIVATE_KEY_KEY,
    encodeBase64(deviceKeyPair.privateKey.expose()),
    getSecureStoreOptions(),
  );
  storage.set(DEVICE_ID_KEY, deviceId);
  storage.set(DEVICE_PUBLIC_KEY_KEY, deviceKeyPair.publicKey);

  return {
    algorithm: deviceKeyPair.algorithm,
    deviceId,
    privateKey: deviceKeyPair.privateKey,
    publicKey: deviceKeyPair.publicKey,
  };
};

export const ensureDeviceKeyRegistration = async () => {
  const context = await getOrCreateDeviceKeyContext();
  await trpcClient.auth.registerDeviceKey.mutate({
    algorithm: context.algorithm,
    deviceId: context.deviceId,
    name: null,
    publicKey: context.publicKey,
  });

  return context;
};

export const getCurrentDeviceId = async () => {
  const context = await getOrCreateDeviceKeyContext();
  return context.deviceId;
};
