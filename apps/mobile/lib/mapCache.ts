import { OfflineManager } from "@maplibre/maplibre-react-native";
import { storage } from "./storage.ts";

export const mapCacheLimitMb = 250;

const lastSourceUrlKey = "map.lastSourceUrl";
const lastArchiveIdKey = "map.lastArchiveId";
const clearPendingKey = "map.clearPending";

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
  storage.remove("map.cacheSizeMb");
  await OfflineManager.setMaximumAmbientCacheSize(mapCacheLimitMb * 1_000_000);
};
