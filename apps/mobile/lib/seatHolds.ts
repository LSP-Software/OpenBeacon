import { Platform } from "react-native";
import { z } from "zod";
import { queryClient, type RouterOutputs, trpc, trpcClient } from "./api.ts";
import { baseUrl } from "./currentServer.ts";
import { hasLocallyPausedSharing } from "./locationSharing.ts";
import { showEventNotice } from "./notifications.ts";
import { parseJson } from "./parseJson.ts";
import { storage } from "./storage.ts";
import {
  getCheckedGroupNames,
  getCheckedMembership,
  getGroupNamesSignature,
  getMembershipSignature,
} from "./trackingKeyCheck.ts";
import { loadTrackingModule } from "./trackingModule.ts";

const HELD_KEY_PREFIX = "seatHolds.held.";

const heldKey = (userId: string) => `${HELD_KEY_PREFIX}${JSON.stringify([baseUrl, userId])}`;

const storedHolds = z.object({
  held: z.array(z.string()),
  membership: z.string().nullable(),
  names: z.string().nullable().default(null),
});

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

export const noteHeldGroups = async ({
  deviceId,
  heldGroupIds,
  userId,
}: {
  deviceId: string;
  heldGroupIds: string[];
  userId: string;
}) => {
  const owner = JSON.stringify([baseUrl, userId]);
  const stored = storedHolds.safeParse(parseJson(storage.getString(heldKey(userId)) ?? ""));
  const previous = stored.success ? stored.data : null;
  const trackingModule = Platform.OS === "android" ? await loadTrackingModule() : null;
  const nativeHeld = trackingModule ? trackingModule.seatHoldGroupIds(owner, deviceId) : undefined;
  if (nativeHeld === null) return;
  const appliedHeld = nativeHeld ?? previous?.held ?? [];
  if (
    heldGroupIds.length === 0 &&
    (previous === null || previous.held.length === 0) &&
    appliedHeld.length === 0
  ) {
    if (previous === null) {
      storage.set(heldKey(userId), JSON.stringify({ held: [], membership: null, names: null }));
    }
    return;
  }
  const membership = getCheckedMembership();
  const names = getCheckedGroupNames();
  if (
    previous?.membership &&
    previous.names &&
    sameIds(previous.held, heldGroupIds) &&
    sameIds(appliedHeld, heldGroupIds) &&
    (membership === null || membership === previous.membership) &&
    (names === null || names === previous.names)
  ) {
    return;
  }
  const groups: RouterOutputs["groupMembership"]["list"] =
    await trpcClient.groupMembership.list.query();
  if (trackingModule) {
    const applied = trackingModule.setSeatHoldNotice(
      owner,
      deviceId,
      Object.fromEntries(groups.map((group) => [group.id, group.name])),
      heldGroupIds,
    );
    if (!applied) return;
  }
  storage.set(
    heldKey(userId),
    JSON.stringify({
      held: heldGroupIds,
      membership: getMembershipSignature(groups),
      names: getGroupNamesSignature(groups),
    }),
  );
  queryClient.setQueryData(trpc.groupMembership.list.queryKey(), groups);
  const paused = hasLocallyPausedSharing(userId);
  const lifted = groups.filter(
    (group) => previous?.held.includes(group.id) && !heldGroupIds.includes(group.id),
  );
  for (const group of lifted) {
    await showEventNotice({
      title: `${group.name} is active again`,
      body: paused
        ? "Your location sharing stays paused until you turn it back on."
        : "This phone is sharing its location with the group again.",
      groupName: group.name,
      key: `seatHoldLifted.${group.id}.${Date.now()}`,
      kind: "accountAlert",
      link: {
        href: { pathname: "/(tabs)/groups/[groupId]", params: { groupId: group.id } },
        url: `openbeacon:///groups/${encodeURIComponent(group.id)}`,
      },
    });
  }
};

export const forgetSeatHoldGroupNames = () => {
  for (const key of storage.getAllKeys()) {
    if (!key.startsWith(HELD_KEY_PREFIX)) continue;
    const stored = storedHolds.safeParse(parseJson(storage.getString(key) ?? ""));
    if (stored.success && stored.data.held.length > 0) {
      storage.set(key, JSON.stringify({ ...stored.data, membership: null, names: null }));
    }
  }
};

export const clearSeatHolds = async () => {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(HELD_KEY_PREFIX)) storage.remove(key);
  }
  if (Platform.OS !== "android") return;
  const trackingModule = await loadTrackingModule();
  trackingModule?.clearSeatHoldNotices();
};
