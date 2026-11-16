import { placeAlertsCursorSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import z from "zod";
import { queryClient, type RouterOutputs, trpcClient } from "./api.ts";
import { baseUrl } from "./currentServer.ts";
import { getRegisteredDeviceKey } from "./deviceKeys.ts";
import { showPlaceNotice } from "./notifications.ts";
import { loadPersonalNicknames } from "./personalNicknames.ts";
import { catchUpGroupPlaces } from "./placeCatchUp.ts";
import { groupPlacesQueryKey, loadGroupPlaces } from "./placeSync.ts";
import { storage } from "./storage.ts";
import { loadTrackingModule } from "./trackingModule.ts";

type PlaceAlert = NonNullable<
  RouterOutputs["groupTracking"]["uploadBatch"]["placeAlerts"]
>["alerts"][number];

export type PlaceUpdates = {
  places?: RouterOutputs["groupTracking"]["uploadBatch"]["places"];
  placeAlerts?: RouterOutputs["groupTracking"]["uploadBatch"]["placeAlerts"];
};

type Groups = () => Promise<RouterOutputs["groupMembership"]["list"]>;

const knownPlacesSchema = z.record(z.string(), z.string());

const storageKey = (userId: string, name: string, groupId?: string) =>
  `places.${name}.${JSON.stringify([baseUrl, userId, ...(groupId ? [groupId] : [])])}`;

const placesTabLink = (groupId: string) => ({
  href: { pathname: "/(tabs)/groups/[groupId]", params: { groupId, tab: "places" } } as const,
  url: `openbeacon:///groups/${encodeURIComponent(groupId)}?tab=places`,
});

const placeOnMapLink = (placeId: string) => ({
  href: { pathname: "/(tabs)/map", params: { placeId } } as const,
  url: `openbeacon:///map?placeId=${encodeURIComponent(placeId)}`,
});

export const getPlaceAlertsCursor = (userId: string) => {
  const parsed = placeAlertsCursorSchema.safeParse(
    storage.getString(storageKey(userId, "alertsCursor")),
  );
  return parsed.success ? parsed.data : null;
};

export const describePlaceAlert = ({
  alert,
  ownerName,
}: {
  alert: Pick<PlaceAlert, "deviceName" | "direction" | "placeEmoji" | "placeName">;
  ownerName: string | null;
}) =>
  `${ownerName ?? "Someone"}’s ${alert.deviceName} ${alert.direction === "ARRIVE" ? "arrived at" : "left"} ${alert.placeEmoji} ${alert.placeName}`;

export const describePlacesChanged = ({
  added,
  groupName,
  moved,
}: {
  added: readonly { emoji: string; name: string }[];
  groupName: string;
  moved: readonly { emoji: string; name: string }[];
}) => {
  const changed = [...added, ...moved];
  const verb = moved.length === 0 ? "added" : added.length === 0 ? "moved" : "changed";
  const only = changed.length === 1 ? changed[0] : undefined;
  return {
    title: only
      ? `${groupName} ${verb} ${only.emoji} ${only.name}`
      : `${groupName} ${verb} ${changed.length} places`,
    body: `This phone will tell ${groupName} when it arrives at or leaves ${only ? only.name : "them"}.`,
  };
};

const readKnownPlaces = async (userId: string, groupId: string) => {
  const raw = storage.getString(storageKey(userId, "known", groupId));
  if (raw === undefined) return {};
  const parsed = await tryCatch(Promise.resolve().then((): unknown => JSON.parse(raw)));
  return knownPlacesSchema.catch({}).parse(parsed.data);
};

export const syncGroupPlaces = async ({
  announce,
  groupId,
  groups = () => trpcClient.groupMembership.list.query(),
  userId,
}: {
  announce: boolean;
  groupId: string;
  groups?: Groups;
  userId: string;
}) => {
  const device = await getRegisteredDeviceKey();
  if (!device || device.userId !== userId) return false;
  const [places, sharing] = await Promise.all([
    loadGroupPlaces(groupId),
    trpcClient.placeSharing.get.query({ groupId }),
  ]);
  const ready = places.flatMap((place) =>
    place.geometry ? [{ ...place, geometry: place.geometry }] : [],
  );
  const trackingModule = await loadTrackingModule();
  if (trackingModule) {
    const applied = await trackingModule.setGroupPlaces(
      JSON.stringify([baseUrl, userId]),
      device.deviceId,
      groupId,
      sharing.enabled
        ? ready.map(({ geometry, id }) => ({
            placeId: id,
            latitude: geometry.latitude,
            longitude: geometry.longitude,
            radiusMeters: geometry.radiusMeters,
          }))
        : [],
    );
    if (!applied) return false;
  }
  const known = await readKnownPlaces(userId, groupId);
  const next = Object.fromEntries(
    ready.map(({ geometry, id }) => [
      id,
      `${geometry.latitude},${geometry.longitude},${geometry.radiusMeters}`,
    ]),
  );
  storage.set(storageKey(userId, "known", groupId), JSON.stringify(next));
  if (!announce || !sharing.enabled) return true;
  const added = ready.filter(({ id }) => known[id] === undefined);
  const moved = ready.filter(({ id }) => known[id] !== undefined && known[id] !== next[id]);
  if (added.length + moved.length === 0) return true;
  const group = (await groups()).find(({ id }) => id === groupId);
  if (!group) return true;
  await showPlaceNotice({
    ...describePlacesChanged({ added, groupName: group.name, moved }),
    groupName: group.name,
    key: groupId,
    kind: "placesChanged",
    link: placesTabLink(groupId),
  });
  return true;
};

const showPlaceAlerts = async ({
  alerts,
  groups,
  userId,
}: {
  alerts: readonly PlaceAlert[];
  groups: Groups;
  userId: string;
}) => {
  const nicknames = new Map<string, Promise<Record<string, { name: string | null }>>>();
  const nicknamesFor = (groupId: string) => {
    const loaded =
      nicknames.get(groupId) ??
      tryCatch(loadPersonalNicknames(groupId, userId)).then((result) => result.data ?? {});
    nicknames.set(groupId, loaded);
    return loaded;
  };
  for (const alert of alerts) {
    const group = (await groups()).find(({ id }) => id === alert.groupId);
    if (!group) continue;
    const member = group.members.find((item) => item.userId === alert.userId);
    const ownerName = member
      ? ((await nicknamesFor(alert.groupId))[member.id]?.name ?? member.name)
      : null;
    await showPlaceNotice({
      title: describePlaceAlert({ alert, ownerName }),
      body: null,
      groupName: group.name,
      key: alert.id,
      kind: "alert",
      link: placeOnMapLink(alert.placeId),
    });
  }
};

export const applyPlaceUpdates = async ({
  updates,
  userId,
}: {
  updates: PlaceUpdates;
  userId: string;
}) => {
  let groupList: ReturnType<Groups> | null = null;
  const groups: Groups = () => {
    groupList ??= trpcClient.groupMembership.list.query();
    return groupList;
  };
  for (const summary of updates.places ?? []) {
    const revisionKey = storageKey(userId, "revision", summary.groupId);
    if (storage.getNumber(revisionKey) !== summary.revision) {
      const synced = await tryCatch(
        syncGroupPlaces({ announce: true, groupId: summary.groupId, groups, userId }),
      );
      if (synced.data) {
        storage.set(revisionKey, summary.revision);
        await queryClient.invalidateQueries({ queryKey: groupPlacesQueryKey(summary.groupId) });
      }
    }
    const catchUpKey = storageKey(userId, "catchUpAt", summary.groupId);
    if (summary.needsCatchUp && Date.now() - (storage.getNumber(catchUpKey) ?? 0) >= 15 * 60_000) {
      storage.set(catchUpKey, Date.now());
      const moved = await tryCatch(catchUpGroupPlaces({ groupId: summary.groupId, userId }));
      if (moved.data) {
        await queryClient.invalidateQueries({ queryKey: groupPlacesQueryKey(summary.groupId) });
      }
    }
  }
  if (!updates.placeAlerts) return;
  const shown = await tryCatch(
    showPlaceAlerts({ alerts: updates.placeAlerts.alerts, groups, userId }),
  );
  if (shown.error) return;
  storage.set(storageKey(userId, "alertsCursor"), updates.placeAlerts.cursor);
};
