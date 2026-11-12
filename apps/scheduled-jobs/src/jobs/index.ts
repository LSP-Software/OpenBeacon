import { runAccountDeletion } from "./accountDeletion.ts";
import { runExpiredRecordsCleanup } from "./expiredRecordsCleanup.ts";
import { runImageStorageSweep, runStalePendingUploadCleanup } from "./imageUploadCleanup.ts";
import { createEpochCleanup, createLocationHistoryCleanup } from "./locationHistoryCleanup.ts";
import { createMapTilesUpdate } from "./mapTilesUpdate.ts";
import { runPendingDeviceCleanup } from "./pendingDeviceCleanup.ts";

const runMapTilesUpdate = createMapTilesUpdate({
  apiKey: process.env["MAP_TILES_API_KEY"],
  url: process.env["MAP_TILES_SERVICE_URL"],
});

export const jobs = [
  { name: "account-deletion", delay: 60_000, run: runAccountDeletion },
  { name: "expired-records-cleanup", delay: 3_600_000, run: runExpiredRecordsCleanup },
  { name: "pending-device-cleanup", delay: 3_600_000, run: runPendingDeviceCleanup },
  { name: "location-history-cleanup", delay: 3_600_000, run: createLocationHistoryCleanup() },
  { name: "epoch-cleanup", delay: 86_400_000, run: createEpochCleanup() },
  { name: "pending-upload-cleanup", delay: 3_600_000, run: runStalePendingUploadCleanup },
  { name: "image-storage-sweep", delay: 86_400_000, run: runImageStorageSweep },
  ...(runMapTilesUpdate
    ? [{ name: "map-tiles-update", delay: 86_400_000, run: runMapTilesUpdate }]
    : []),
];
