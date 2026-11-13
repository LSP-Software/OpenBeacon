import { locationSharingChangeInputSchema } from "@openbeacon/schemas";
import {
  resolveLocationSharing,
  tryCatch,
  type DeviceSharingState,
  type SharingPreference,
} from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { Platform } from "react-native";
import superjson from "superjson";
import { z } from "zod";
import { trpcClient } from "./api.ts";
import { baseUrl } from "./currentServer.ts";
import { createSecureId } from "./createSecureId.ts";
import { getRegisteredDeviceKey, getStoredDeviceId } from "./deviceKeys.ts";
import { errorReason } from "./errorReason.ts";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";
import { storage } from "./storage.ts";
import { requestTrackingSync } from "./trackingEvents.ts";

const pendingPrefix = "locationSharing.pending.";
const pendingKey = (userId: string, scope: "device" | "account") =>
  `${pendingPrefix}${JSON.stringify([baseUrl, userId, scope])}`;
const rejectedKey = (userId: string) =>
  `${pendingPrefix}${JSON.stringify([baseUrl, userId, "rejected"])}`;
const localPauseKey = (userId: string, deviceId: string) =>
  `locationSharing.localPause.${JSON.stringify([baseUrl, userId, deviceId])}`;
const syncedKey = (userId: string, deviceId: string) =>
  `locationSharing.synced.${JSON.stringify([baseUrl, userId, deviceId])}`;
const clockOffsetKey = () => `locationSharing.clockOffset.${JSON.stringify(baseUrl)}`;
const preferenceSchema = z.object({
  sharingPaused: z.boolean(),
  sharingPausedUntil: z.date().nullable(),
  sharingChangedAt: z.date().nullable(),
  sharingRevision: z.number().int().min(0),
});
const syncedSchema = z.object({
  account: preferenceSchema,
  device: preferenceSchema,
});
const scheduledChanges = new Set<string>();
type LoadedSharingState = Awaited<ReturnType<typeof trpcClient.account.locationSharing.query>>;
const loadedStateListeners = new Set<(state: LoadedSharingState) => void>();
let changeRevision = 0;
const latestScopeRevisions = new Map<"device" | "account", number>();
let generation = 0;
let operationQueue: Promise<unknown> = Promise.resolve();

const queueOperation = <T>(operation: () => Promise<T>) => {
  const task = operationQueue.then(operation, operation);
  operationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

const parseStored = <T>(schema: z.ZodType<T>, stored: string) => {
  try {
    const result = schema.safeParse(superjson.parse(stored));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const readPendingChange = (userId: string, scope: "device" | "account") => {
  const key = pendingKey(userId, scope);
  const stored = storage.getString(key);
  if (!stored) return null;
  const input = parseStored(locationSharingChangeInputSchema, stored);
  if (!input) storage.remove(key);
  return input ? { stored, input } : null;
};

const readSyncedPreferences = (userId: string, deviceId: string) => {
  const stored = storage.getString(syncedKey(userId, deviceId));
  return stored ? parseStored(syncedSchema, stored) : null;
};

const clockOffset = () => {
  const offset = Number(storage.getString(clockOffsetKey()));
  return Number.isFinite(offset) ? offset : 0;
};

export const serverNow = () => Date.now() + clockOffset();

export const toDeviceClock = (serverTime: Date) => new Date(serverTime.getTime() - clockOffset());

export const getPendingSharingChanges = (userId: string) => ({
  device: readPendingChange(userId, "device")?.input ?? null,
  account: readPendingChange(userId, "account")?.input ?? null,
});

export const hasPendingSharingPause = (userId: string) =>
  storage.getString(pendingKey(userId, "device")) !== undefined ||
  storage.getString(pendingKey(userId, "account")) !== undefined;

export const abandonLocationSharingChanges = () => {
  generation += 1;
};

export const clearPendingSharingChanges = (userId?: string) => {
  const userKeys = userId
    ? [pendingKey(userId, "device"), pendingKey(userId, "account"), rejectedKey(userId)]
    : null;
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(pendingPrefix) && (!userKeys || userKeys.includes(key))) storage.remove(key);
  }
};

export const hasRejectedSharingChange = (userId: string) =>
  storage.getString(rejectedKey(userId)) !== undefined;

const isRejectedForGood = (error: unknown) => {
  if (!(error instanceof TRPCClientError) || !error.data) return false;
  const code = error.data.code;
  return (
    code === "BAD_REQUEST" ||
    code === "NOT_FOUND" ||
    (code === "FORBIDDEN" && errorReason(error) === null)
  );
};

export const hasLocallyPausedSharing = (userId: string) => {
  const deviceId = getStoredDeviceId(userId);
  const stored = deviceId ? storage.getString(localPauseKey(userId, deviceId)) : undefined;
  return stored === "true" || Number(stored) > Date.now();
};

const applyNativeSharingState = async (state: DeviceSharingState, isCurrent: () => boolean) => {
  if (Platform.OS !== "android") return false;
  const module = (await import("../modules/openbeacon-tracking/index.ts")).default;
  if (!isCurrent()) return false;
  const pausedUntil = state.pausedUntil ? toDeviceClock(state.pausedUntil).getTime() : null;
  const applied = module.setSharingState(
    JSON.stringify([baseUrl, state.userId]),
    state.deviceId,
    state.revisionPrefix,
    state.paused,
    pausedUntil,
    state.resumeAfter ? toDeviceClock(state.resumeAfter).getTime() : null,
  );
  if (applied) {
    const key = localPauseKey(state.userId, state.deviceId);
    if (state.paused) storage.set(key, pausedUntil === null ? "true" : String(pausedUntil));
    else storage.remove(key);
  }
  return applied;
};

const applyLocalSharingState = (
  device: { userId: string; deviceId: string },
  isCurrent: () => boolean,
) => {
  const synced = readSyncedPreferences(device.userId, device.deviceId);
  const preference = (scope: "device" | "account"): SharingPreference => {
    const known = synced?.[scope] ?? {
      sharingPaused: false,
      sharingPausedUntil: null,
      sharingChangedAt: null,
      sharingRevision: 0,
    };
    const pending = readPendingChange(device.userId, scope)?.input;
    if (!pending || (pending.scope === "device" && pending.deviceId !== device.deviceId))
      return known;
    return {
      sharingPaused: pending.paused,
      sharingPausedUntil: pending.pausedUntil,
      sharingChangedAt: null,
      sharingRevision: known.sharingRevision,
    };
  };
  const now = serverNow();
  const effective = resolveLocationSharing(preference("account"), preference("device"), now);
  return applyNativeSharingState(
    {
      ...device,
      paused: effective.paused,
      pausedUntil: effective.pausedUntil,
      resumeAfter: new Date(now),
      revisionPrefix: effective.revisionPrefix,
    },
    isCurrent,
  );
};

const synchronizeSharing = async (requestedGeneration: number) => {
  const revision = changeRevision;
  const abandoned = () => generation !== requestedGeneration;
  if (abandoned()) return;
  const device = await getRegisteredDeviceKey();
  if (!device || abandoned()) return;
  let replayError: unknown = null;
  for (const scope of ["device", "account"] as const) {
    const pending = readPendingChange(device.userId, scope);
    if (!pending || scheduledChanges.has(pending.input.requestId)) continue;
    const key = pendingKey(device.userId, scope);
    if (pending.input.scope === "device" && pending.input.deviceId !== device.deviceId) {
      if (storage.getString(key) === pending.stored) storage.remove(key);
      continue;
    }
    const replay = await tryCatch(trpcClient.account.setLocationSharing.mutate(pending.input));
    if (abandoned()) return;
    if (replay.error && !isRejectedForGood(replay.error)) {
      replayError ??= replay.error;
      continue;
    }
    if (storage.getString(key) !== pending.stored) continue;
    storage.remove(key);
    if (replay.error) storage.set(rejectedKey(device.userId), "true");
  }
  const state = await loadSharingState(device, revision, abandoned);
  if (replayError) throw replayError;
  return state;
};

const loadSharingState = async (
  device: { userId: string; deviceId: string },
  revision: number,
  abandoned: () => boolean,
) => {
  const requestedAt = Date.now();
  const state = await trpcClient.account.locationSharing.query();
  if (abandoned()) return;
  storage.set(
    clockOffsetKey(),
    String(Math.round(state.serverTime.getTime() - (requestedAt + Date.now()) / 2)),
  );
  if (state.deviceId !== device.deviceId || state.userId !== device.userId) return;
  storage.set(
    syncedKey(device.userId, device.deviceId),
    superjson.stringify({ account: state.account, device: state.device }),
  );
  for (const listener of loadedStateListeners) listener(state);
  const isCurrent = () =>
    !abandoned() && !hasPendingSharingPause(device.userId) && changeRevision === revision;
  await applyNativeSharingState(state, isCurrent);
  return state;
};

export const onSharingStateLoaded = (listener: (state: LoadedSharingState) => void) => {
  loadedStateListeners.add(listener);
  return () => {
    loadedStateListeners.delete(listener);
  };
};

export const syncLocationSharing = () => {
  const requestedGeneration = generation;
  return queueOperation(() => synchronizeSharing(requestedGeneration));
};

export const changeLocationSharing = async (input: {
  scope: "device" | "account";
  deviceId?: string;
  paused: boolean;
  durationMinutes: 15 | 60 | 480 | 1440 | null;
  expectedRevision?: number;
}) => {
  const revision = ++changeRevision;
  latestScopeRevisions.set(input.scope, revision);
  const requestedGeneration = generation;
  const device = await getRegisteredDeviceKey();
  if (!device) throw new Error("This device isn't registered yet.");
  if (generation !== requestedGeneration) throw new Error("You've signed out.");
  const deviceId = input.deviceId ?? device.deviceId;
  const affectsThisDevice = input.scope === "account" || deviceId === device.deviceId;
  const offline = await (await import("./networkStatus.ts")).isDeviceOffline();
  if (latestScopeRevisions.get(input.scope) !== revision)
    throw new Error("A newer sharing change replaced this one.");
  if (offline && !affectsThisDevice) throw new Error(SERVER_UNREACHABLE_MESSAGE);
  const key = pendingKey(device.userId, input.scope);
  const queued = affectsThisDevice ? readPendingChange(device.userId, input.scope) : null;
  const synced = affectsThisDevice
    ? readSyncedPreferences(device.userId, device.deviceId)?.[input.scope]
    : null;
  const durationMinutes = input.paused ? input.durationMinutes : null;
  const requestedAt = new Date(serverNow());
  const change = locationSharingChangeInputSchema.parse({
    scope: input.scope,
    ...(input.scope === "device" ? { deviceId } : {}),
    expectedUserId: device.userId,
    requestId: createSecureId("sharing"),
    expectedRevision:
      input.expectedRevision ?? queued?.input.expectedRevision ?? synced?.sharingRevision ?? null,
    replacesRequestId: queued?.input.requestId ?? null,
    paused: input.paused,
    durationMinutes,
    pausedUntil:
      durationMinutes === null ? null : new Date(requestedAt.getTime() + durationMinutes * 60_000),
    requestedAt,
  });
  const stored = superjson.stringify(change);
  const isCurrent = () => revision === changeRevision && generation === requestedGeneration;
  scheduledChanges.add(change.requestId);
  try {
    if (affectsThisDevice) {
      storage.set(key, stored);
      if (change.paused) await applyLocalSharingState(device, isCurrent);
    }
    storage.remove(rejectedKey(device.userId));
    const result = offline
      ? { data: null, error: new Error(SERVER_UNREACHABLE_MESSAGE) }
      : await tryCatch(
          queueOperation(async () => {
            if (generation !== requestedGeneration) throw new Error("You've signed out.");
            const { status } = await trpcClient.account.setLocationSharing.mutate(
              change.paused ? { ...change, expectedRevision: null } : change,
            );
            if (generation !== requestedGeneration) return status;
            if (storage.getString(key) === stored) storage.remove(key);
            await tryCatch(synchronizeSharing(requestedGeneration));
            return status;
          }),
        );
    if (!result.error) return result.data;
    if (!affectsThisDevice || storage.getString(key) !== stored) throw result.error;
    if (isRejectedForGood(result.error)) {
      storage.remove(key);
      storage.set(rejectedKey(device.userId), "true");
      await tryCatch(queueOperation(() => synchronizeSharing(requestedGeneration)));
      return "rejected" as const;
    }
    if (change.paused && !hasLocallyPausedSharing(device.userId)) throw result.error;
    if (
      !change.paused &&
      !(await applyLocalSharingState(device, isCurrent)) &&
      Platform.OS === "android" &&
      isCurrent() &&
      storage.getString(key) === stored
    ) {
      if (queued) storage.set(key, queued.stored);
      else storage.remove(key);
      throw result.error;
    }
    return "queued" as const;
  } finally {
    scheduledChanges.delete(change.requestId);
    requestTrackingSync();
  }
};
