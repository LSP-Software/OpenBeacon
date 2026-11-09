import { beforeEach, expect, jest, mock, test } from "bun:test";
import { createDeviceKeyPair, DEVICE_KEY_ALGORITHM } from "@openbeacon/encryption";

type Progress = { done: number; failed: number; total: number };

const keyPair = createDeviceKeyPair();
const device = {
  algorithm: DEVICE_KEY_ALGORITHM,
  deviceId: "device-1",
  privateKey: keyPair.privateKey,
  publicKey: keyPair.publicKey,
  userId: "user-1",
};
let backfill: (onProgress: (progress: Progress) => void) => Promise<Progress>;
let reseal: () => Promise<void>;

mock.module("./recovery.ts", () => ({
  backfillEveryGroup: ({ onProgress }: { onProgress: (progress: Progress) => void }) =>
    backfill(onProgress),
}));
mock.module("./resealPersonalData.ts", () => ({
  resealPersonalData: () => reseal(),
}));

const { protectHistory } = await import("./protectHistory.ts");

beforeEach(() => {
  backfill = async (onProgress) => {
    onProgress({ done: 0, failed: 0, total: 1 });
    onProgress({ done: 1, failed: 0, total: 1 });
    return { done: 1, failed: 0, total: 1 };
  };
  reseal = async () => {};
});

test("reports the backfill's progress when it finishes in time", async () => {
  const progress: Progress[] = [];

  await protectHistory({ device, onProgress: (next) => progress.push(next) });

  expect(progress).toEqual([
    { done: 0, failed: 0, total: 1 },
    { done: 1, failed: 0, total: 1 },
  ]);
});

test("gives up after the timeout when the network never answers and reports a failure", async () => {
  jest.useFakeTimers();
  try {
    let lateProgress: ((progress: Progress) => void) | undefined;
    backfill = (onProgress) => {
      onProgress({ done: 0, failed: 0, total: 2 });
      lateProgress = onProgress;
      return new Promise(() => {});
    };
    const progress: Progress[] = [];

    const protecting = protectHistory({
      device,
      onProgress: (next) => progress.push(next),
      timeoutMs: 20_000,
    });
    jest.advanceTimersByTime(20_000);
    await protecting;
    lateProgress?.({ done: 2, failed: 0, total: 2 });

    expect(progress).toEqual([
      { done: 0, failed: 0, total: 2 },
      { done: 0, failed: 1, total: 2 },
    ]);
  } finally {
    jest.useRealTimers();
  }
});

test("a reseal that never answers also ends at the timeout", async () => {
  jest.useFakeTimers();
  try {
    reseal = () => new Promise(() => {});
    const progress: Progress[] = [];

    const protecting = protectHistory({ device, onProgress: (next) => progress.push(next) });
    jest.advanceTimersByTime(20_000);
    await protecting;

    expect(progress.at(-1)).toEqual({ done: 1, failed: 1, total: 1 });
  } finally {
    jest.useRealTimers();
  }
});
