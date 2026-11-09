import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  DevicePrivateKeyMaterial,
  decodeBase64,
  encodeBase64,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { trpcClient } from "./api.ts";
import { createSecureId } from "./createSecureId.ts";
import { storage } from "./storage.ts";

const DEVICE_ID_KEY = "encryption.device.id";
const DEVICE_PUBLIC_KEY_KEY = "encryption.device.publicKey";
const DEVICE_PRIVATE_KEY_KEY = "encryption.device.privateKey";

const getScopedDeviceKey = (key: string, userId: string) => `${key}.${userId}`;

export const getStoredDeviceId = (userId: string) =>
  storage.getString(getScopedDeviceKey(DEVICE_ID_KEY, userId));

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
  const { deviceIdKey, privateKeyKey, publicKeyKey } = getScopedDeviceKeyNames(userId);

  try {
    storage.set(deviceIdKey, deviceId);
    storage.set(publicKeyKey, publicKey);
    await SecureStore.setItemAsync(
      privateKeyKey,
      encodeBase64(privateKey),
      getSecureStoreOptions(),
    );
  } catch (error) {
    storage.remove(deviceIdKey);
    storage.remove(publicKeyKey);
    await SecureStore.deleteItemAsync(privateKeyKey, getSecureStoreOptions());
    throw error;
  }
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

const registerDeviceKey = async ({
  algorithm,
  deviceId,
  publicKey,
  userId,
}: {
  algorithm: typeof DEVICE_KEY_ALGORITHM;
  deviceId: string;
  publicKey: string;
  userId: string;
}) =>
  trpcClient.auth.registerDeviceKey.mutate({
    algorithm,
    deviceId,
    publicKey,
    expectedUserId: userId,
    platform: Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : undefined,
    model: Device.modelName ?? undefined,
  });

const deviceKeyContexts = new Map<
  string,
  Promise<NonNullable<Awaited<ReturnType<typeof getStoredDeviceKeyContext>>>>
>();

export const getOrCreateDeviceKeyContext = (userId: string) => {
  const pending = deviceKeyContexts.get(userId);
  if (pending) return pending;
  const task = createDeviceKeyContext(userId).finally(() => {
    deviceKeyContexts.delete(userId);
  });
  deviceKeyContexts.set(userId, task);
  return task;
};

const createDeviceKeyContext = async (userId: string) => {
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

const deviceRegistrations = new Map<
  string,
  Promise<NonNullable<Awaited<ReturnType<typeof getStoredDeviceKeyContext>>> & { userId: string }>
>();
let deviceRegistrationGeneration = 0;

export const cancelDeviceKeyRegistrations = () => {
  deviceRegistrationGeneration += 1;
  deviceRegistrations.clear();
};

export const ensureDeviceKeyRegistration = async () => {
  const generation = deviceRegistrationGeneration;
  const userId = await getCurrentDeviceKeyOwnerId();
  if (generation !== deviceRegistrationGeneration)
    throw new Error("Device registration cancelled.");
  const pending = deviceRegistrations.get(userId);
  if (pending) return pending;
  const task = registerCurrentDeviceKey(userId, generation)
    .then((context) => ({ ...context, userId }))
    .finally(() => {
      if (deviceRegistrations.get(userId) === task) deviceRegistrations.delete(userId);
    });
  deviceRegistrations.set(userId, task);
  return task;
};

const registerCurrentDeviceKey = async (userId: string, generation: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await tryCatch(
    Promise.race([
      getOrCreateDeviceKeyContext(userId),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Device key storage is unavailable.")), 10_000);
      }),
    ]),
  );
  clearTimeout(timeout);
  if (result.error) throw result.error;
  const context = result.data;
  if (generation !== deviceRegistrationGeneration)
    throw new Error("Device registration cancelled.");
  await registerDeviceKey({ ...context, userId });
  if (generation !== deviceRegistrationGeneration)
    throw new Error("Device registration cancelled.");

  return context;
};

export const getCurrentDeviceId = async () => {
  const userId = await getCurrentDeviceKeyOwnerId();
  const context = await getOrCreateDeviceKeyContext(userId);
  return context.deviceId;
};
