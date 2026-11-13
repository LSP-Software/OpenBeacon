import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";
import { queryClient, trpc, trpcClient } from "./api.ts";
import { clearApiCompatibility } from "./apiCompatibility.ts";
import { authClient, forgetSessionTokenToRevoke } from "./auth-client.ts";
import {
  deleteDeviceKey,
  forgetDeviceKeyRegistration,
  getStoredDeviceId,
  stopDeviceKeyRegistrations,
} from "./deviceKeys.ts";
import { isDeviceRemovedError } from "./deviceRemovedError.ts";
import { clearGroupColors } from "./groupColor.ts";
import { deleteStoredHistoryKeys } from "./historyKeys.ts";
import { clearPendingSharingChanges, getPendingSharingChanges } from "./locationSharing.ts";
import { clearPendingJoinCodes } from "./pendingJoinCode.ts";
import { readRegisteredDevice } from "./registeredDevice.ts";
import { deleteSavedDeviceLink } from "./savedDeviceLink.ts";
import { storage } from "./storage.ts";
import { clearTrackingKeyCheck } from "./trackingKeyCheck.ts";
import { clearTrackingUploadTimes } from "./trackingUploadTime.ts";

export type EndSessionReason =
  "signedOut" | "phoneRemoved" | "accountDeleted" | "serverChanged" | "sessionLost";

export const endSessionClears = {
  signedOut: {
    credentials: "signOut",
    queuedPoints: "heldBackByPause",
    pendingSharingChanges: true,
    pendingJoinCodes: true,
    keyMaterial: "keep",
    compatibility: false,
  },
  phoneRemoved: {
    credentials: "signOut",
    queuedPoints: "all",
    pendingSharingChanges: true,
    pendingJoinCodes: true,
    keyMaterial: "wipe",
    compatibility: false,
  },
  accountDeleted: {
    credentials: "signOut",
    queuedPoints: "all",
    pendingSharingChanges: true,
    pendingJoinCodes: true,
    keyMaterial: "wipe",
    compatibility: false,
  },
  serverChanged: {
    credentials: "signOutAndDropRevokeToken",
    queuedPoints: "all",
    pendingSharingChanges: true,
    pendingJoinCodes: true,
    keyMaterial: "keepUntilExpiry",
    compatibility: true,
  },
  sessionLost: {
    credentials: "keep",
    queuedPoints: "none",
    pendingSharingChanges: false,
    pendingJoinCodes: true,
    keyMaterial: "keepUntilExpiry",
    compatibility: false,
  },
} as const satisfies Record<
  EndSessionReason,
  {
    credentials: "signOut" | "signOutAndDropRevokeToken" | "keep";
    queuedPoints: "all" | "heldBackByPause" | "none";
    pendingSharingChanges: boolean;
    pendingJoinCodes: boolean;
    keyMaterial: "wipe" | "keepUntilExpiry" | "keep";
    compatibility: boolean;
  }
>;

const LOST_SESSIONS_KEY = "session.lost";

const lostSessionsSchema = z.array(z.object({ userId: z.string(), lostAt: z.number() }));

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readLostSessions = () => {
  const stored = storage.getString(LOST_SESSIONS_KEY);
  if (!stored) return [];
  const parsed = lostSessionsSchema.safeParse(parseJson(stored));
  return parsed.success ? parsed.data : [];
};

const writeLostSessions = (sessions: { userId: string; lostAt: number }[]) => {
  if (sessions.length) storage.set(LOST_SESSIONS_KEY, JSON.stringify(sessions));
  else storage.remove(LOST_SESSIONS_KEY);
};

const recordLostSession = ({ userId, lostAt }: { userId: string; lostAt: number }) =>
  writeLostSessions([
    ...readLostSessions().filter((session) => session.userId !== userId),
    { userId, lostAt },
  ]);

const forgetLostSession = (userId: string) =>
  writeLostSessions(readLostSessions().filter((session) => session.userId !== userId));

const wipeKeyMaterial = async ({
  deviceId,
  historyKeyVersion,
  userId,
}: {
  deviceId: string | undefined;
  historyKeyVersion: number;
  userId: string;
}) => {
  await tryCatch(
    deleteStoredHistoryKeys({
      userId,
      upToVersion: Math.max(historyKeyVersion, 100),
    }),
  );
  if (deviceId) await tryCatch(deleteSavedDeviceLink({ deviceId, userId }));
  await tryCatch(deleteDeviceKey(userId));
  forgetLostSession(userId);
};

const isRemovedAfterSessionLoss = async (registered: { deviceId: string }) => {
  const result = await tryCatch(
    trpcClient.auth.providers.query(undefined, { context: { handleDeviceErrors: false } }),
  );
  if ((await readRegisteredDevice())?.deviceId !== registered.deviceId) return null;
  return isDeviceRemovedError(result.error);
};

export const endSession = async ({
  reason,
}: {
  reason: EndSessionReason;
}): Promise<{ signedOut: boolean }> => {
  const clears = endSessionClears[reason];
  const registered = await readRegisteredDevice();
  if (reason === "sessionLost") {
    if (!registered) return { signedOut: false };
    stopDeviceKeyRegistrations();
    const removed = await isRemovedAfterSessionLoss(registered);
    if (removed === null) return { signedOut: false };
    if (removed) {
      await (await import("./deviceRemoved.ts")).handleDeviceRemoved();
      return { signedOut: true };
    }
  }
  stopDeviceKeyRegistrations();
  const userId =
    registered?.userId ??
    (clears.credentials === "keep"
      ? undefined
      : (await tryCatch(trpcClient.auth.deviceKeyContext.query())).data?.userId);
  const deviceId = registered?.deviceId ?? (userId ? getStoredDeviceId(userId) : undefined);
  await queryClient.cancelQueries();
  const historyKeyVersion =
    queryClient.getQueryData(trpc.accountRecovery.status.queryKey())?.currentHistoryKey?.version ??
    0;
  const tracking = await import("./tracking.ts");
  await tryCatch(tracking.revokeTrackingAccess({ keepDeviceRegistration: true }));

  let keepPendingSharingChanges = !clears.pendingSharingChanges;
  if (userId && clears.queuedPoints === "all") {
    await tryCatch(tracking.deleteQueuedTrackingPoints({ deviceId, userId }));
  }
  if (userId && clears.queuedPoints === "heldBackByPause") {
    const pending = getPendingSharingChanges(userId);
    if (pending.account?.paused || pending.device?.paused) {
      const deleted = await tryCatch(tracking.deleteQueuedTrackingPoints({ deviceId, userId }));
      if (deleted.error) keepPendingSharingChanges = true;
    }
  }
  if (userId && clears.keyMaterial === "wipe") {
    await wipeKeyMaterial({ deviceId, historyKeyVersion, userId });
  }
  if (!keepPendingSharingChanges) clearPendingSharingChanges();

  forgetDeviceKeyRegistration();
  let signedOut = false;
  if (clears.credentials !== "keep") {
    const result = await tryCatch(authClient.signOut());
    signedOut = !result.error && !result.data.error;
  }
  if (clears.credentials === "signOutAndDropRevokeToken") {
    await tryCatch(forgetSessionTokenToRevoke());
  }
  if (clears.pendingJoinCodes) clearPendingJoinCodes();
  queryClient.clear();
  clearGroupColors();
  clearTrackingUploadTimes();
  clearTrackingKeyCheck();
  if (clears.compatibility) clearApiCompatibility();
  if (userId && clears.keyMaterial === "keepUntilExpiry") {
    recordLostSession({ userId, lostAt: Date.now() });
  }
  return { signedOut };
};

export const settleLostSessions = async ({
  now = Date.now(),
  userId,
}: {
  now?: number;
  userId: string | null;
}) => {
  for (const lost of readLostSessions()) {
    if (lost.userId === userId) {
      forgetLostSession(lost.userId);
      continue;
    }
    if (!userId && now - lost.lostAt < 30 * 24 * 60 * 60_000) continue;
    const deviceId = getStoredDeviceId(lost.userId);
    const tracking = await import("./tracking.ts");
    await tryCatch(tracking.deleteQueuedTrackingPoints({ deviceId, userId: lost.userId }));
    clearPendingSharingChanges(lost.userId);
    await wipeKeyMaterial({ deviceId, historyKeyVersion: 0, userId: lost.userId });
  }
};
