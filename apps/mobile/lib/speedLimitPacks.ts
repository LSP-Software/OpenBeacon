import { tryCatch } from "@openbeacon/shared";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { getLastKnownPositionAsync } from "expo-location";
import { getNetworkStateAsync, NetworkStateType } from "expo-network";
import { Platform } from "react-native";
import OpenBeaconTracking from "../modules/openbeacon-tracking/index.ts";
import { trpcClient } from "./api.ts";
import { refreshSpeedLimitPacks } from "./speedLimitRefresh.ts";
import { storage } from "./storage.ts";

const checkedAtKey = "speedLimits.checkedAt";
const regionAtKey = "speedLimits.regionAt";
const boundariesFile = () => new File(Paths.document, "speed-limit-boundaries.json");

export const speedLimitPackBudgetMb = 500;

export const refreshSpeedLimitData = async () => {
  if (Platform.OS !== "android") return;
  await refreshSpeedLimitPacks({
    now: Date.now,
    detectionOn: () => OpenBeaconTracking.isDriveDetectionOn(),
    recording: () => OpenBeaconTracking.isDriveRecording(),
    onWifi: async () => {
      const state = await getNetworkStateAsync();
      return state.type === NetworkStateType.WIFI || state.type === NetworkStateType.ETHERNET;
    },
    position: async () => {
      const last = await tryCatch(getLastKnownPositionAsync({ maxAge: 60 * 60 * 1000 }));
      return last.data?.coords ?? null;
    },
    readState: () => ({
      checkedAt: storage.getNumber(checkedAtKey) ?? 0,
      regionAt: storage.getNumber(regionAtKey) ?? 0,
    }),
    writeState: ({ checkedAt, regionAt }) => {
      storage.set(checkedAtKey, checkedAt);
      storage.set(regionAtKey, regionAt);
    },
    readBoundaries: async () => {
      const file = boundariesFile();
      return file.exists ? file.text() : null;
    },
    writeBoundaries: async (text) => {
      boundariesFile().write(text);
    },
    fetchSignedPacks: () => trpcClient.maps.getSignedSpeedLimitPackUrls.query(),
    fetchText: async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Speed limit boundaries download failed: ${response.status}`);
      return response.text();
    },
    sha256: (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
    installed: async () => (await OpenBeaconTracking.speedLimitPacks()).packs,
    noteRegion: (regionId) => OpenBeaconTracking.noteSpeedLimitRegion(regionId),
    download: (request) => OpenBeaconTracking.downloadSpeedLimitPack(request),
  });
};

export const readSpeedLimitDataSize = async () => {
  if (Platform.OS !== "android") return 0;
  const { packs } = await OpenBeaconTracking.speedLimitPacks();
  return packs.reduce((total, pack) => total + pack.size, 0);
};

export const deleteSpeedLimitData = async () => {
  storage.remove(checkedAtKey);
  storage.remove(regionAtKey);
  const file = boundariesFile();
  if (file.exists) file.delete();
  if (Platform.OS === "android") await OpenBeaconTracking.deleteSpeedLimitPacks();
};
