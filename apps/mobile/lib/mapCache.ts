import { OfflineManager } from "@maplibre/maplibre-react-native";
import { storage } from "./storage.ts";

export const mapCacheSizesMb = [100, 250, 500, 1000] as const;

type MapCacheSizeMb = (typeof mapCacheSizesMb)[number];

const sizeKey = "map.cacheSizeMb";
const lastSourceUrlKey = "map.lastSourceUrl";
const lastArchiveIdKey = "map.lastArchiveId";
const clearPendingKey = "map.clearPending";

export const getMapCacheSizeMb = (): MapCacheSizeMb => {
  const stored = storage.getNumber(sizeKey);
  return mapCacheSizesMb.find((size) => size === stored) ?? 250;
};

const applySize = (size: MapCacheSizeMb) =>
  OfflineManager.setMaximumAmbientCacheSize(size * 1_000_000);

export const applyMapCacheSize = () => applySize(getMapCacheSizeMb());

export const setMapCacheSizeMb = async (size: MapCacheSizeMb) => {
  await applySize(size);
  storage.set(sizeKey, size);
};

export const readLastMapSource = () => {
  const sourceUrl = storage.getString(lastSourceUrlKey);
  if (!sourceUrl) return null;
  return { archiveId: storage.getString(lastArchiveIdKey) ?? null, sourceUrl };
};

export const saveLastMapSource = ({
  archiveId,
  sourceUrl,
}: {
  archiveId: string | null;
  sourceUrl: string;
}) => {
  storage.set(lastSourceUrlKey, sourceUrl);
  if (archiveId) storage.set(lastArchiveIdKey, archiveId);
  else storage.remove(lastArchiveIdKey);
};

export const clearCachedMapTiles = () => OfflineManager.clearAmbientCache();

export const clearSavedMap = async () => {
  storage.set(clearPendingKey, true);
  storage.remove(lastSourceUrlKey);
  storage.remove(lastArchiveIdKey);
  await clearCachedMapTiles();
  storage.remove(clearPendingKey);
};

export const prepareMapCache = async () => {
  if (storage.getBoolean(clearPendingKey)) await clearSavedMap();
  await applyMapCacheSize();
};
