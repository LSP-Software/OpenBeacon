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
import { baseUrl } from "./base-url.ts";
import { createSecureId } from "./createSecureId.ts";
import { readRegisteredDevice, REGISTERED_DEVICE_KEY } from "./registeredDevice.ts";
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

type DeviceRegistration = NonNullable<Awaited<ReturnType<typeof getStoredDeviceKeyContext>>> & {
  userId: string;
};

const deviceRegistrations = new Map<string, Promise<DeviceRegistration>>();
let deviceRegistrationGeneration = 0;
let registeredDevice: DeviceRegistration | null = null;

export const forgetDeviceKeyRegistration = () => {
  registeredDevice = null;
  storage.remove(REGISTERED_DEVICE_KEY);
};

export const deleteDeviceKey = async (userId: string) => {
  cancelDeviceKeyRegistrations();
  await clearStoredDeviceKeyContext(getScopedDeviceKeyNames(userId));
  await clearStoredDeviceKeyContext({
    deviceIdKey: DEVICE_ID_KEY,
    privateKeyKey: DEVICE_PRIVATE_KEY_KEY,
    publicKeyKey: DEVICE_PUBLIC_KEY_KEY,
  });
};

export const cancelDeviceKeyRegistrations = () => {
  deviceRegistrationGeneration += 1;
  deviceRegistrations.clear();
  forgetDeviceKeyRegistration();
};

const withStorageTimeout = async <T>(task: Promise<T>) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await tryCatch(
    Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Device key storage is unavailable.")), 10_000);
      }),
    ]),
  );
  clearTimeout(timeout);
  if (result.error) throw result.error;
  return result.data;
};

const loadRegisteredDevice = async (): Promise<DeviceRegistration | null> => {
  if (registeredDevice) return registeredDevice;
  const record = await readRegisteredDevice();
  if (!record) return null;
  const { userId, deviceId, publicKey } = record;
  const context = await withStorageTimeout(getStoredDeviceKeyContext(userId));
  if (!context || context.deviceId !== deviceId || context.publicKey !== publicKey) return null;
  return { ...context, userId };
};

export const getRegisteredDeviceKey = async () => {
  const generation = deviceRegistrationGeneration;
  const device = await tryCatch(loadRegisteredDevice());
  if (generation !== deviceRegistrationGeneration || !device.data) return null;
  registeredDevice = device.data;
  return device.data;
};

export const ensureDeviceKeyRegistration = async ({
  checkOwner = false,
}: { checkOwner?: boolean } = {}) => {
  const generation = deviceRegistrationGeneration;
  const cached = await getRegisteredDeviceKey();
  if (cached && !checkOwner) return cached;
  const userId = await getCurrentDeviceKeyOwnerId();
  if (generation !== deviceRegistrationGeneration)
    throw new Error("Device registration cancelled.");
  if (cached?.userId === userId) return cached;
  if (cached) forgetDeviceKeyRegistration();
  const pending = deviceRegistrations.get(userId);
  if (pending) return pending;
  const task = registerCurrentDeviceKey(userId, generation)
    .then((context) => {
      const device = { ...context, userId };
      if (generation === deviceRegistrationGeneration) {
        registeredDevice = device;
        storage.set(
          REGISTERED_DEVICE_KEY,
          JSON.stringify([baseUrl, userId, context.deviceId, context.publicKey]),
        );
      }
      return device;
    })
    .finally(() => {
      if (deviceRegistrations.get(userId) === task) deviceRegistrations.delete(userId);
    });
  deviceRegistrations.set(userId, task);
  return task;
};

const registerCurrentDeviceKey = async (userId: string, generation: number) => {
  const context = await withStorageTimeout(getOrCreateDeviceKeyContext(userId));
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
