import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
  decodeBase64,
  encodeBase64,
} from "@openbeacon/encryption";
import * as SecureStore from "expo-secure-store";
import { trpcClient } from "./api.ts";
import { createSecureId } from "./createSecureId.ts";
import { storage } from "./storage.ts";
import { tryCatch } from "./tryCatch.ts";

const DEVICE_ID_KEY = "encryption.device.id";
const DEVICE_PUBLIC_KEY_KEY = "encryption.device.publicKey";
const DEVICE_PRIVATE_KEY_KEY = "encryption.device.privateKey";

const getScopedDeviceKey = (key: string, userId: string) => `${key}.${userId}`;

const getScopedDeviceKeyNames = (userId: string) => ({
  deviceIdKey: getScopedDeviceKey(DEVICE_ID_KEY, userId),
  privateKeyKey: getScopedDeviceKey(DEVICE_PRIVATE_KEY_KEY, userId),
  publicKeyKey: getScopedDeviceKey(DEVICE_PUBLIC_KEY_KEY, userId),
});

const getSecureStoreOptions = () => ({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

const loadStoredDeviceKeyContext = async ({
  deviceIdKey,
  privateKeyKey,
  publicKeyKey,
}: {
  deviceIdKey: string;
  privateKeyKey: string;
  publicKeyKey: string;
}) => {
  const deviceId = storage.getString(deviceIdKey);
  const publicKey = storage.getString(publicKeyKey);
  const privateKey = await SecureStore.getItemAsync(privateKeyKey, getSecureStoreOptions());

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

const clearStoredDeviceKeyContext = async ({
  deviceIdKey,
  privateKeyKey,
  publicKeyKey,
}: {
  deviceIdKey: string;
  privateKeyKey: string;
  publicKeyKey: string;
}) => {
  storage.remove(deviceIdKey);
  storage.remove(publicKeyKey);
  await SecureStore.deleteItemAsync(privateKeyKey, getSecureStoreOptions());
};

const persistStoredDeviceKeyContext = async ({
  deviceId,
  privateKey,
  publicKey,
  userId,
}: {
  deviceId: string;
  privateKey: Uint8Array;
  publicKey: string;
  userId: string;
}) => {
  const privateKeyKey = getScopedDeviceKey(DEVICE_PRIVATE_KEY_KEY, userId);

  await SecureStore.setItemAsync(privateKeyKey, encodeBase64(privateKey), getSecureStoreOptions());
  storage.set(getScopedDeviceKey(DEVICE_ID_KEY, userId), deviceId);
  storage.set(getScopedDeviceKey(DEVICE_PUBLIC_KEY_KEY, userId), publicKey);
};

const getLegacyDeviceKeyContext = async () =>
  loadStoredDeviceKeyContext({
    deviceIdKey: DEVICE_ID_KEY,
    privateKeyKey: DEVICE_PRIVATE_KEY_KEY,
    publicKeyKey: DEVICE_PUBLIC_KEY_KEY,
  });

export const getStoredDeviceKeyContext = async (userId: string) => {
  const { deviceIdKey, privateKeyKey, publicKeyKey } = getScopedDeviceKeyNames(userId);
  const existingContext = await loadStoredDeviceKeyContext({
    deviceIdKey,
    privateKeyKey,
    publicKeyKey,
  });

  if (existingContext) {
    return existingContext;
  }

  const legacyContext = await getLegacyDeviceKeyContext();
  if (!legacyContext) {
    return null;
  }

  await persistStoredDeviceKeyContext({
    deviceId: legacyContext.deviceId,
    privateKey: legacyContext.privateKey.expose(),
    publicKey: legacyContext.publicKey,
    userId,
  });
  await clearStoredDeviceKeyContext({
    deviceIdKey: DEVICE_ID_KEY,
    privateKeyKey: DEVICE_PRIVATE_KEY_KEY,
    publicKeyKey: DEVICE_PUBLIC_KEY_KEY,
  });

  return legacyContext;
};

const getCurrentDeviceKeyOwnerId = async () => {
  const deviceKeyContext = await trpcClient.auth.deviceKeyContext.query();
  return deviceKeyContext.userId;
};

const isDeviceOwnedByAnotherUserError = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("This device is already registered to another user.");

const registerDeviceKey = async ({
  algorithm,
  deviceId,
  publicKey,
}: {
  algorithm: typeof DEVICE_KEY_ALGORITHM;
  deviceId: string;
  publicKey: string;
}) =>
  trpcClient.auth.registerDeviceKey.mutate({
    algorithm,
    deviceId,
    publicKey,
  });

export const getOrCreateDeviceKeyContext = async (userId: string) => {
  const existingContext = await getStoredDeviceKeyContext(userId);

  if (existingContext) {
    return existingContext;
  }

  const deviceKeyPair = createDeviceKeyPair();
  const deviceId = createSecureId("device");

  await persistStoredDeviceKeyContext({
    deviceId,
    privateKey: deviceKeyPair.privateKey.expose(),
    publicKey: deviceKeyPair.publicKey,
    userId,
  });

  return {
    algorithm: deviceKeyPair.algorithm,
    deviceId,
    privateKey: deviceKeyPair.privateKey,
    publicKey: deviceKeyPair.publicKey,
  };
};

export const ensureDeviceKeyRegistration = async () => {
  const userId = await getCurrentDeviceKeyOwnerId();
  let context = await getOrCreateDeviceKeyContext(userId);
  const registrationResult = await tryCatch(registerDeviceKey(context));

  if (!registrationResult.error) {
    return context;
  }

  if (!isDeviceOwnedByAnotherUserError(registrationResult.error)) {
    throw registrationResult.error;
  }

  await clearStoredDeviceKeyContext(getScopedDeviceKeyNames(userId));
  context = await getOrCreateDeviceKeyContext(userId);
  await registerDeviceKey(context);

  return context;
};

export const getCurrentDeviceId = async () => {
  const userId = await getCurrentDeviceKeyOwnerId();
  const context = await getOrCreateDeviceKeyContext(userId);
  return context.deviceId;
};
