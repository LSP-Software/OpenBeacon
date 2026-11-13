import { expect, test } from "bun:test";
import { launchRetryDelayMs } from "./launchRetry.ts";

test("backs off the launch retries to 5 s, 15 s, then 60 s and stays there", () => {
  expect([1, 2, 3, 4, 10].map(launchRetryDelayMs)).toEqual([5_000, 15_000, 60_000, 60_000, 60_000]);
});
