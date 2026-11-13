import { tryCatch } from "@openbeacon/shared";
import * as SecureStore from "expo-secure-store";
import { getSecureStoreOptions } from "./secureStoreOptions.ts";

const generations = new Map<string, number>();
const pendingWrites = new Map<string, Set<Promise<void>>>();
const keyOperations = new Map<string, Promise<unknown>>();

export const SECRET_STORAGE_UNAVAILABLE_MESSAGE = "Key storage is unavailable.";
const SIGNED_OUT_MESSAGE = "This phone was signed out while saving its keys.";

export const secretOwner = (userId: string) => ({
  userId,
  generation: generations.get(userId) ?? 0,
});

const isCurrent = (owner: { userId: string; generation: number }) =>
  (generations.get(owner.userId) ?? 0) === owner.generation;

export const withSecretDeadline = async <T>(task: Promise<T>) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await tryCatch(
    Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(SECRET_STORAGE_UNAVAILABLE_MESSAGE)), 10_000);
      }),
    ]),
  );
  clearTimeout(timeout);
  if (result.error) throw result.error;
  return result.data;
};

const queueForKey = <T>(key: string, operation: () => Promise<T>) => {
  const task = (keyOperations.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  keyOperations.set(key, task);
  void task
    .catch(() => {})
    .finally(() => {
      if (keyOperations.get(key) === task) keyOperations.delete(key);
    });
  return task;
};

export const readSecret = (key: string) =>
  withSecretDeadline(SecureStore.getItemAsync(key, getSecureStoreOptions()));

export const deleteSecret = (key: string) =>
  withSecretDeadline(
    queueForKey(key, () => SecureStore.deleteItemAsync(key, getSecureStoreOptions())),
  );

export const writeSecret = async (
  owner: { userId: string; generation: number },
  key: string,
  value: string,
) => {
  if (!isCurrent(owner)) throw new Error(SIGNED_OUT_MESSAGE);
  const write = queueForKey(key, async () => {
    if (!isCurrent(owner)) throw new Error(SIGNED_OUT_MESSAGE);
    await SecureStore.setItemAsync(key, value, getSecureStoreOptions());
    if (isCurrent(owner)) return;
    await SecureStore.deleteItemAsync(key, getSecureStoreOptions());
    throw new Error(SIGNED_OUT_MESSAGE);
  });
  const writes = pendingWrites.get(owner.userId) ?? new Set<Promise<void>>();
  pendingWrites.set(owner.userId, writes);
  writes.add(write);
  void write
    .catch(() => {})
    .finally(() => {
      writes.delete(write);
      if (writes.size === 0 && pendingWrites.get(owner.userId) === writes)
        pendingWrites.delete(owner.userId);
    });
  return write;
};

export const invalidateSecretWrites = async (userId: string) => {
  generations.set(userId, (generations.get(userId) ?? 0) + 1);
  await tryCatch(withSecretDeadline(Promise.allSettled([...(pendingWrites.get(userId) ?? [])])));
};
