import { runAccountDeletion } from "./accountDeletion.ts";
import { runVerificationCleanup } from "./verificationCleanup.ts";

export const jobs = [
  { name: "account-deletion", delay: 60_000, run: runAccountDeletion },
  { name: "verification-cleanup", delay: 3_600_000, run: runVerificationCleanup },
];
