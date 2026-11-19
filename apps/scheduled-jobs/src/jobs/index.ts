import { runAccountDeletion } from "./accountDeletion.ts";
import { runExpiredRecordsCleanup } from "./expiredRecordsCleanup.ts";
import { runImageStorageSweep, runStalePendingUploadCleanup } from "./imageUploadCleanup.ts";
import {
  createEpochCleanup,
  createLocationHistoryCleanup,
  createGroupHistoryCleanup,
} from "./locationHistoryCleanup.ts";
import { runPendingDeviceCleanup } from "./pendingDeviceCleanup.ts";
import { runSeatsEnded } from "./seatsEnded.ts";
import { runUploadGrowthReport } from "./uploadGrowthReport.ts";

export const jobs = [
  { name: "account-deletion", delay: 60_000, run: runAccountDeletion },
  { name: "expired-records-cleanup", delay: 3_600_000, run: runExpiredRecordsCleanup },
  { name: "pending-device-cleanup", delay: 3_600_000, run: runPendingDeviceCleanup },
  { name: "location-history-cleanup", delay: 3_600_000, run: createLocationHistoryCleanup() },
  { name: "group-history-cleanup", delay: 3_600_000, run: createGroupHistoryCleanup() },
  { name: "epoch-cleanup", delay: 86_400_000, run: createEpochCleanup() },
  { name: "pending-upload-cleanup", delay: 3_600_000, run: runStalePendingUploadCleanup },
  { name: "image-storage-sweep", delay: 86_400_000, run: runImageStorageSweep },
  { name: "upload-growth-report", delay: 86_400_000, run: runUploadGrowthReport },
  { name: "seats-ended", delay: 3_600_000, run: runSeatsEnded },
];
