import { afterAll, expect, mock, test } from "bun:test";
import { startScheduler } from "../scheduler.ts";

const runAccountDeletion = mock(async () => {});
const runVerificationCleanup = mock(async () => {});
const runPendingDeviceCleanup = mock(async () => {});

mock.module("./accountDeletion.ts", () => ({ runAccountDeletion }));
mock.module("./verificationCleanup.ts", () => ({ runVerificationCleanup }));
mock.module("./pendingDeviceCleanup.ts", () => ({ runPendingDeviceCleanup }));
const { jobs } = await import("./index.ts");
afterAll(() => mock.restore());

test("registers verification and Pending device clean-up hourly alongside account deletion", async () => {
  expect(jobs).toEqual([
    { name: "account-deletion", delay: 60_000, run: runAccountDeletion },
    { name: "verification-cleanup", delay: 3_600_000, run: runVerificationCleanup },
    { name: "pending-device-cleanup", delay: 3_600_000, run: runPendingDeviceCleanup },
  ]);
  await startScheduler(jobs)();
  expect(runVerificationCleanup).toHaveBeenCalledTimes(1);
  expect(runPendingDeviceCleanup).toHaveBeenCalledTimes(1);
});
