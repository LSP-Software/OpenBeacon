import { afterAll, expect, mock, test } from "bun:test";
import { startScheduler } from "../scheduler.ts";

const runAccountDeletion = mock(async () => {});
const runExpiredRecordsCleanup = mock(async () => {});
const runPendingDeviceCleanup = mock(async () => {});
const runLocationHistoryCleanup = mock(async () => {});
const runEpochCleanup = mock(async () => {});
const runStalePendingUploadCleanup = mock(async () => {});
const runImageStorageSweep = mock(async () => {});

mock.module("./accountDeletion.ts", () => ({ runAccountDeletion }));
mock.module("./expiredRecordsCleanup.ts", () => ({ runExpiredRecordsCleanup }));
mock.module("./pendingDeviceCleanup.ts", () => ({ runPendingDeviceCleanup }));
mock.module("./locationHistoryCleanup.ts", () => ({
  createLocationHistoryCleanup: () => runLocationHistoryCleanup,
  createEpochCleanup: () => runEpochCleanup,
}));
mock.module("./imageUploadCleanup.ts", () => ({
  runStalePendingUploadCleanup,
  runImageStorageSweep,
}));
const { jobs } = await import("./index.ts");
afterAll(() => mock.restore());

test("registers the clean-up jobs alongside account deletion", async () => {
  expect(jobs).toEqual([
    { name: "account-deletion", delay: 60_000, run: runAccountDeletion },
    { name: "expired-records-cleanup", delay: 3_600_000, run: runExpiredRecordsCleanup },
    { name: "pending-device-cleanup", delay: 3_600_000, run: runPendingDeviceCleanup },
    { name: "location-history-cleanup", delay: 3_600_000, run: runLocationHistoryCleanup },
    { name: "epoch-cleanup", delay: 86_400_000, run: runEpochCleanup },
    { name: "pending-upload-cleanup", delay: 3_600_000, run: runStalePendingUploadCleanup },
    { name: "image-storage-sweep", delay: 86_400_000, run: runImageStorageSweep },
  ]);
  await startScheduler(jobs)();
  expect(runExpiredRecordsCleanup).toHaveBeenCalledTimes(1);
  expect(runPendingDeviceCleanup).toHaveBeenCalledTimes(1);
  expect(runLocationHistoryCleanup).toHaveBeenCalledTimes(1);
  expect(runEpochCleanup).toHaveBeenCalledTimes(1);
  expect(runStalePendingUploadCleanup).toHaveBeenCalledTimes(1);
  expect(runImageStorageSweep).toHaveBeenCalledTimes(1);
});
