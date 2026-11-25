import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { alertsCursorSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import z from "zod";
import {
  accountRequest,
  type AccountRound,
  isRoundCurrent,
  startAccountRound,
} from "./accountSession.ts";
import { queryClient, type RouterOutputs, trpc, trpcClient } from "./api.ts";
import { getBaseUrl } from "./currentServer.ts";
import { getRegisteredDeviceKey } from "./deviceKeys.ts";
import { applyCrashAlerts } from "./crashAlertSync.ts";
import { catchUpGroupImageKeys } from "./imageKeyCatchUp.ts";
import { imageKeyCatchUpWaitMs } from "./imageKeyCatchUpBackoff.ts";
import { showNotices } from "./noticeBackgroundSync.ts";
import { showEventNotice } from "./notifications.ts";
import { ownedDeviceName } from "./ownedDeviceName.ts";
import { parseJson } from "./parseJson.ts";
import { nicknamesByGroup } from "./nicknamesByGroup.ts";
import { catchUpGroupPlaces } from "./placeCatchUp.ts";
import { groupPlacesQueryKey, loadGroupPlaces } from "./placeSync.ts";
import { storage } from "./storage.ts";
import { loadTrackingModule } from "./trackingModule.ts";
import { thisDeviceNoun } from "./thisDeviceNoun.ts";

type PlaceAlert = NonNullable<
  RouterOutputs["groupTracking"]["uploadBatch"]["placeAlerts"]
>["alerts"][number];

export type PlaceUpdates = {
  places?: RouterOutputs["groupTracking"]["uploadBatch"]["places"];
  placeAlerts?: RouterOutputs["groupTracking"]["uploadBatch"]["placeAlerts"];
  imageKeysNeedCatchUp?: RouterOutputs["groupTracking"]["uploadBatch"]["imageKeysNeedCatchUp"];
  notices?: RouterOutputs["groupTracking"]["uploadBatch"]["notices"];
  crashAlerts?: RouterOutputs["groupTracking"]["uploadBatch"]["crashAlerts"];
};

type Groups = () => Promise<RouterOutputs["groupMembership"]["list"]>;

const knownPlacesSchema = z.record(z.string(), z.string());
const imageKeyMissesSchema = z.record(
  z.string(),
  z.object({ epoch: z.string().optional(), misses: z.number() }),
);

const imageKeyCatchUps = new Set<Promise<void>>();

const placeOwner = (userId: string) => JSON.stringify([getBaseUrl(), userId]);

const storageKey = (userId: string, name: string, groupId?: string) =>
  `places.${name}.${JSON.stringify([getBaseUrl(), userId, ...(groupId ? [groupId] : [])])}`;

const placesTabLink = (groupId: string) => ({
  href: { pathname: "/(tabs)/groups/[groupId]", params: { groupId, tab: "places" } } as const,
  url: `openbeacon:///groups/${encodeURIComponent(groupId)}?tab=places`,
});

const placeOnMapLink = (placeId: string) => ({
  href: { pathname: "/(tabs)/map", params: { placeId } } as const,
  url: `openbeacon:///map?placeId=${encodeURIComponent(placeId)}`,
});

export const getPlaceAlertsCursor = (userId: string) => {
  const parsed = alertsCursorSchema.safeParse(
    storage.getString(storageKey(userId, "alertsCursor")),
  );
  return parsed.success ? parsed.data : null;
};

export const describePlaceAlert = ({
  alert,
  ownerNames,
}: {
  alert: Pick<PlaceAlert, "deviceName" | "direction" | "placeEmoji" | "placeName">;
  ownerNames: readonly string[];
}) => ({
  title: `${alert.direction === "ARRIVE" ? "Arrived at" : "Left"} ${alert.placeEmoji} ${alert.placeName}`,
  body: ownedDeviceName({ deviceName: alert.deviceName, ownerNames, isYou: false }),
});

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
    body: `This ${thisDeviceNoun()} will tell ${groupName} when it arrives at or leaves ${only ? only.name : "them"}.`,
  };
};

const readStoredJson = (key: string) => {
  const raw = storage.getString(key);
  return raw === undefined ? undefined : parseJson(raw);
};

const geometryHash = (geometry: string) =>
  geometry.includes(",") ? bytesToHex(sha256(utf8ToBytes(geometry))) : geometry;

const readKnownPlaces = (key: string) =>
  Object.fromEntries(
    Object.entries(knownPlacesSchema.catch({}).parse(readStoredJson(key))).map(
      ([placeId, geometry]) => [placeId, geometryHash(geometry)],
    ),
  );

const hashStoredPlaceGeometry = () => {
  for (const key of storage.getAllKeys()) {
    if (!key.startsWith("places.known.") || !storage.getString(key)?.includes(",")) continue;
    storage.set(key, JSON.stringify(readKnownPlaces(key)));
  }
};

export const syncGroupPlaces = async ({
  groupId,
  groups = () => trpcClient.groupMembership.list.query(),
  quietPlaceIds,
  round,
  sharingOff = false,
  userId,
}: {
  groupId: string;
  groups?: Groups;
  quietPlaceIds: readonly string[] | "all";
  round?: AccountRound;
  sharingOff?: boolean;
  userId: string;
}) => {
  const account = round ?? startAccountRound(userId);
  const device = await getRegisteredDeviceKey();
  if (!device || device.userId !== userId) return false;
  const trackingModule = await loadTrackingModule();
  if (sharingOff) {
    if (!isRoundCurrent(account)) return false;
    return trackingModule
      ? trackingModule.setGroupPlaces(placeOwner(userId), device.deviceId, groupId, [])
      : true;
  }
  const [places, sharing] = await Promise.all([
    loadGroupPlaces(groupId, accountRequest(account)),
    trpcClient.placeSharing.get.query({ groupId }, accountRequest(account)),
  ]);
  const ready = places.flatMap((place) =>
    place.geometry ? [{ ...place, geometry: place.geometry }] : [],
  );
  if (!isRoundCurrent(account)) return false;
  if (trackingModule) {
    const applied = await trackingModule.setGroupPlaces(
      placeOwner(userId),
      device.deviceId,
      groupId,
      ready.map(({ geometry, id }) => ({
        placeId: id,
        latitude: geometry.latitude,
        longitude: geometry.longitude,
        radiusMeters: geometry.radiusMeters,
        sharesTransitions: sharing.enabled,
      })),
    );
    if (!applied) return false;
  }
  const known = readKnownPlaces(storageKey(userId, "known", groupId));
  const next = Object.fromEntries(
    ready.map(({ geometry, id }) => [
      id,
      geometryHash(`${geometry.latitude},${geometry.longitude},${geometry.radiusMeters}`),
    ]),
  );
  storage.set(storageKey(userId, "known", groupId), JSON.stringify(next));
  if (quietPlaceIds === "all" || !sharing.enabled) return true;
  const announced = ready.filter(({ id }) => !quietPlaceIds.includes(id));
  const added = announced.filter(({ id }) => known[id] === undefined);
  const moved = announced.filter(({ id }) => known[id] !== undefined && known[id] !== next[id]);
  if (added.length + moved.length === 0) return true;
  const group = (await groups()).find(({ id }) => id === groupId);
  if (!group) return true;
  await showEventNotice({
    ...describePlacesChanged({ added, groupName: group.name, moved }),
    groupName: group.name,
    key: groupId,
    kind: "placesChanged",
    link: placesTabLink(groupId),
    round: account,
  });
  return true;
};

const showPlaceAlerts = async ({
  alerts,
  groups,
  round,
}: {
  alerts: readonly PlaceAlert[];
  groups: Groups;
  round: AccountRound;
}) => {
  const nicknamesFor = nicknamesByGroup(round.userId);
  for (const alert of alerts) {
    const group = (await groups()).find(({ id }) => id === alert.groupId);
    if (!group) continue;
    const member = group.members.find((item) => item.userId === alert.userId);
    const nickname = member ? (await nicknamesFor(alert.groupId))[member.id]?.name : undefined;
    const ownerNames = member ? [...(nickname ? [nickname] : []), member.name] : [];
    await showEventNotice({
      ...describePlaceAlert({ alert, ownerNames }),
      groupName: group.name,
      key: alert.id,
      kind: "alert",
      link: placeOnMapLink(alert.placeId),
      round,
    });
  }
};

export const markPlacesUnsynced = ({ groupId, userId }: { groupId: string; userId: string }) =>
  storage.remove(storageKey(userId, "revision", groupId));

const readNativeGroups = async (userId: string) => {
  const [device, trackingModule] = await Promise.all([
    getRegisteredDeviceKey(),
    loadTrackingModule(),
  ]);
  if (!device || device.userId !== userId || !trackingModule) return null;
  const groupIds = trackingModule.listPlaceGroups(placeOwner(userId), device.deviceId);
  const keys = trackingModule
    .listProvisionedEpochKeys()
    .filter(({ senderDeviceId }) => senderDeviceId === device.deviceId);
  return {
    detected: groupIds ? new Set(groupIds) : null,
    epochOf: (groupId: string) =>
      keys
        .filter((key) => key.groupId === groupId)
        .map(({ epochId }) => epochId)
        .sort()
        .join(",") || undefined,
  };
};

const catchUpImageKeys = async ({
  epochOf,
  groupIds,
  groups,
  round,
}: {
  epochOf: (groupId: string) => string | undefined;
  groupIds: readonly string[];
  groups: Groups;
  round: AccountRound;
}) => {
  const { userId } = round;
  const missesKey = storageKey(userId, "imageKeysCatchUpMisses");
  const readMisses = () => imageKeyMissesSchema.catch({}).parse(readStoredJson(missesKey));
  const saveMisses = (misses: z.infer<typeof imageKeyMissesSchema>) => {
    const next = JSON.stringify(misses);
    if (next !== storage.getString(missesKey)) storage.set(missesKey, next);
  };
  const previous = readMisses();
  const current = Object.fromEntries(
    groupIds.map((groupId) => {
      const stored = previous[groupId];
      const epoch = epochOf(groupId) ?? stored?.epoch;
      return [groupId, { epoch, misses: stored && stored.epoch === epoch ? stored.misses : 0 }];
    }),
  );
  saveMisses(current);
  const due = groupIds.filter((groupId) => {
    const catchUpKey = storageKey(userId, "imageKeysCatchUpAt", groupId);
    const waitMs = imageKeyCatchUpWaitMs(current[groupId]?.misses ?? 0);
    if (Date.now() - (storage.getNumber(catchUpKey) ?? 0) < waitMs) return false;
    storage.set(catchUpKey, Date.now());
    return true;
  });
  let imageKeysMoved = false;
  for (const groupId of due) {
    if (!isRoundCurrent(round)) return;
    const moved = await tryCatch(catchUpGroupImageKeys({ groupId, groups, userId }));
    imageKeysMoved ||= Boolean(moved.data);
    const latest = readMisses();
    const entry = latest[groupId];
    if (entry) {
      saveMisses({
        ...latest,
        [groupId]: { ...entry, misses: moved.data ? 0 : Math.min(entry.misses + 1, 4) },
      });
    }
  }
  if (imageKeysMoved) {
    await queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() });
  }
};

export const settleImageKeyCatchUps = async () => {
  while (imageKeyCatchUps.size > 0) await Promise.allSettled([...imageKeyCatchUps]);
};

export const applyPlaceUpdates = async ({
  updates,
  round,
}: {
  updates: PlaceUpdates;
  round: AccountRound;
}) => {
  const { userId } = round;
  let groupList: ReturnType<Groups> | null = null;
  const groups: Groups = () => {
    groupList ??= trpcClient.groupMembership.list.query(undefined, accountRequest(round));
    return groupList;
  };
  hashStoredPlaceGeometry();
  const nativeGroups = await readNativeGroups(userId);
  const detectedGroups = nativeGroups?.detected ?? null;
  for (const summary of updates.places ?? []) {
    const revisionKey = storageKey(userId, "revision", summary.groupId);
    if (
      storage.getNumber(revisionKey) !== summary.revision ||
      (detectedGroups !== null && !detectedGroups.has(summary.groupId))
    ) {
      const synced = await tryCatch(
        syncGroupPlaces({ groupId: summary.groupId, groups, quietPlaceIds: [], round, userId }),
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
  if (updates.placeAlerts) {
    const shown = await tryCatch(
      showPlaceAlerts({ alerts: updates.placeAlerts.alerts, groups, round }),
    );
    if (!shown.error && isRoundCurrent(round))
      storage.set(storageKey(userId, "alertsCursor"), updates.placeAlerts.cursor);
  }
  if (updates.crashAlerts) {
    await tryCatch(applyCrashAlerts({ crashAlerts: updates.crashAlerts, groups, round }));
  }
  if (updates.notices) {
    await tryCatch(showNotices({ notices: updates.notices, groups, round }));
  }
  if (updates.imageKeysNeedCatchUp) {
    const catchUp = tryCatch(
      catchUpImageKeys({
        epochOf: nativeGroups?.epochOf ?? (() => undefined),
        groupIds: updates.imageKeysNeedCatchUp,
        groups,
        round,
      }),
    ).then(() => {
      imageKeyCatchUps.delete(catchUp);
    });
    imageKeyCatchUps.add(catchUp);
  }
};
