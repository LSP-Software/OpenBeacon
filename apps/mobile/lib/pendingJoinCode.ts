import { router } from "expo-router";
import z from "zod";
import { readThisDeviceState } from "./deviceActivation.ts";
import { JOIN_CODE, joinInviteFromLink } from "./inviteLink.ts";
import type { JoinInvite } from "./inviteTypes.ts";
import { hasPendingOnboarding } from "./onboardingStorage.ts";
import { parseJson } from "./parseJson.ts";
import { readRegisteredDeviceNow } from "./registeredDevice.ts";
import { storage } from "./storage.ts";

const STORAGE_PREFIX = "pendingJoinCode.";

const savedInviteSchema = z.object({
  savedAt: z.number(),
  code: z.string().regex(JOIN_CODE),
  server: z.string().nullable(),
});

export const clearPendingJoinCodes = () => {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(STORAGE_PREFIX)) storage.remove(key);
  }
};

export const savePendingJoinCode = ({
  code,
  server = null,
  userId,
}: {
  code: string;
  server?: string | null;
  userId: string;
}) => {
  clearPendingJoinCodes();
  storage.set(
    `${STORAGE_PREFIX}${userId}`,
    JSON.stringify({ savedAt: Date.now(), code, server } satisfies z.infer<
      typeof savedInviteSchema
    >),
  );
};

export const takePendingInvite = (userId: string): JoinInvite | null => {
  const stored = storage.getString(`${STORAGE_PREFIX}${userId}`);
  clearPendingJoinCodes();
  if (!stored) return null;
  const saved = savedInviteSchema.safeParse(parseJson(stored));
  if (!saved.success) return null;
  const age = Date.now() - saved.data.savedAt;
  return age >= 0 && age < 24 * 60 * 60 * 1000
    ? { code: saved.data.code, server: saved.data.server }
    : null;
};

const INVITE_FOR_SIGN_IN_KEY = "inviteForSignIn";

export const saveInviteForSignIn = (code: string) =>
  storage.set(INVITE_FOR_SIGN_IN_KEY, JSON.stringify({ savedAt: Date.now(), code }));

export const clearInviteForSignIn = () => storage.remove(INVITE_FOR_SIGN_IN_KEY);

export const takeInviteForSignIn = () => {
  const stored = storage.getString(INVITE_FOR_SIGN_IN_KEY);
  clearInviteForSignIn();
  if (!stored) return null;
  const saved = savedInviteSchema.omit({ server: true }).safeParse(parseJson(stored));
  if (!saved.success) return null;
  const age = Date.now() - saved.data.savedAt;
  return age >= 0 && age < 30 * 60 * 1000 ? saved.data.code : null;
};

export const saveJoinLinkForAfterSetup = (link: string) => {
  const invite = joinInviteFromLink(link)?.invite;
  const device = readRegisteredDeviceNow();
  if (!invite || !device) return false;
  if (readThisDeviceState() === "active" && !hasPendingOnboarding(device.userId)) return false;
  savePendingJoinCode({ ...invite, userId: device.userId });
  return true;
};

export const openAppAfterSetup = (home: "/" | "/(tabs)/map") => {
  const userId = readRegisteredDeviceNow()?.userId;
  const invite = userId ? takePendingInvite(userId) : null;
  if (!userId) clearPendingJoinCodes();
  router.replace(
    invite
      ? {
          pathname: "/join",
          params: invite.server
            ? { code: invite.code, server: invite.server }
            : { code: invite.code },
        }
      : home,
  );
};
