import { afterAll, expect, mock, test } from "bun:test";
import { startScheduler } from "../scheduler.ts";

const runAccountDeletion = mock(async () => {});
const runVerificationCleanup = mock(async () => {});

mock.module("./accountDeletion.ts", () => ({ runAccountDeletion }));
mock.module("./verificationCleanup.ts", () => ({ runVerificationCleanup }));
const { jobs } = await import("./index.ts");
afterAll(() => mock.restore());

test("registers verification cleanup hourly alongside account deletion", async () => {
  expect(jobs).toEqual([
    { name: "account-deletion", delay: 60_000, run: runAccountDeletion },
    { name: "verification-cleanup", delay: 3_600_000, run: runVerificationCleanup },
  ]);
  await startScheduler(jobs)();
  expect(runVerificationCleanup).toHaveBeenCalledTimes(1);
});
