import type { EpochKeyDevice } from "./epochKeys.ts";
import { backfillEveryGroup } from "./recovery.ts";
import { resealPersonalData } from "./resealPersonalData.ts";

export const protectHistory = async ({
  device,
  onProgress,
  timeoutMs = 20_000,
}: {
  device: EpochKeyDevice;
  onProgress: (progress: { done: number; failed: number; total: number }) => void;
  timeoutMs?: number;
}) => {
  let settled = false;
  let latest = { done: 0, failed: 0, total: 0 };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    await backfillEveryGroup({
      device,
      onProgress: (progress) => {
        if (settled) return;
        latest = progress;
        onProgress(progress);
      },
    });
    await resealPersonalData(device.userId);
    return false;
  })();
  const timedOut = await Promise.race([
    work,
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]).finally(() => {
    settled = true;
    clearTimeout(timeout);
  });
  if (timedOut) onProgress({ ...latest, failed: Math.max(latest.failed, 1) });
};
