import { OfflineManager } from "@maplibre/maplibre-react-native";
import { storage } from "./storage.ts";

export const mapCacheSizesMb = [100, 250, 500, 1000] as const;

export type MapCacheSizeMb = (typeof mapCacheSizesMb)[number];

const sizeKey = "map.cacheSizeMb";
const lastSourceUrlKey = "map.lastSourceUrl";
const lastArchiveIdKey = "map.lastArchiveId";

export const getMapCacheSizeMb = (): MapCacheSizeMb => {
  const stored = storage.getNumber(sizeKey);
  return mapCacheSizesMb.find((size) => size === stored) ?? 250;
};

export const applyMapCacheSize = () =>
  OfflineManager.setMaximumAmbientCacheSize(getMapCacheSizeMb() * 1024 * 1024);

export const setMapCacheSizeMb = (size: MapCacheSizeMb) => {
  storage.set(sizeKey, size);
  return applyMapCacheSize();
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

export const clearSavedMap = () => {
  storage.remove(lastSourceUrlKey);
  storage.remove(lastArchiveIdKey);
  return clearCachedMapTiles();
};
