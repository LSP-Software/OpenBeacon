import { Platform } from "react-native";
import { z } from "zod";
import { queryClient, type RouterOutputs, trpc, trpcClient } from "./api.ts";
import { baseUrl } from "./currentServer.ts";
import { hasLocallyPausedSharing } from "./locationSharing.ts";
import { showEventNotice } from "./notifications.ts";
import { parseJson } from "./parseJson.ts";
import { storage } from "./storage.ts";
import { getCheckedMembership, getMembershipSignature } from "./trackingKeyCheck.ts";
import { loadTrackingModule } from "./trackingModule.ts";

const HELD_KEY_PREFIX = "seatHolds.held.";

const heldKey = (userId: string) => `${HELD_KEY_PREFIX}${JSON.stringify([baseUrl, userId])}`;

export const noteHeldGroups = async ({
  deviceId,
  heldGroupIds,
  userId,
}: {
  deviceId: string;
  heldGroupIds: string[];
  userId: string;
}) => {
  const stored = z
    .object({ held: z.array(z.string()), membership: z.string().nullable() })
    .safeParse(parseJson(storage.getString(heldKey(userId)) ?? ""));
  const previous = stored.success ? stored.data : null;
  if (heldGroupIds.length === 0 && (previous === null || previous.held.length === 0)) {
    if (previous === null) {
      storage.set(heldKey(userId), JSON.stringify({ held: [], membership: null }));
    }
    return;
  }
  const membership = getCheckedMembership();
  if (
    previous &&
    previous.held.length === heldGroupIds.length &&
    heldGroupIds.every((groupId) => previous.held.includes(groupId)) &&
    (membership === null || membership === previous.membership)
  ) {
    return;
  }
  const groups: RouterOutputs["groupMembership"]["list"] =
    await trpcClient.groupMembership.list.query();
  if (Platform.OS === "android") {
    const trackingModule = await loadTrackingModule();
    const applied = trackingModule?.setSeatHoldNotice(
      JSON.stringify([baseUrl, userId]),
      deviceId,
      groups.filter((group) => !heldGroupIds.includes(group.id)).map((group) => group.name),
      groups.filter((group) => heldGroupIds.includes(group.id)).map((group) => group.name),
    );
    if (applied === false) return;
  }
  storage.set(
    heldKey(userId),
    JSON.stringify({ held: heldGroupIds, membership: getMembershipSignature(groups) }),
  );
  await queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() });
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

export const clearSeatHolds = async () => {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(HELD_KEY_PREFIX)) storage.remove(key);
  }
  if (Platform.OS !== "android") return;
  const trackingModule = await loadTrackingModule();
  trackingModule?.clearSeatHoldNotices();
};
