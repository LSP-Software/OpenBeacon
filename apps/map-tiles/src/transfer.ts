export const createRateLimiter = ({
  bytesPerSecond,
  now = () => performance.now(),
  sleep = (ms: number) => Bun.sleep(ms),
}: {
  bytesPerSecond: number | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) => {
  let nextAvailableAt = now();

  return {
    take: async (bytes: number) => {
      if (bytesPerSecond === null) {
        return;
      }

      const current = now();
      nextAvailableAt = Math.max(nextAvailableAt, current) + (bytes / bytesPerSecond) * 1000;
      const waitMs = nextAvailableAt - current;

      if (waitMs > 0) {
        await sleep(waitMs);
      }
    },
  };
};

export type RateLimiter = ReturnType<typeof createRateLimiter>;

const MIN_SPEED_SAMPLE_MS = 5_000;

export const createProgressTracker = ({
  now = () => performance.now(),
  windowMs = 60_000,
}: {
  now?: () => number;
  windowMs?: number;
} = {}) => {
  const startedAt = now();
  let samples: { at: number; bytes: number }[] = [];

  return {
    transferred: (bytes: number) => {
      const at = now();
      const last = samples.at(-1);

      if (last && Math.floor(last.at / 1000) === Math.floor(at / 1000)) {
        last.bytes += bytes;
      } else {
        samples.push({ at, bytes });
        samples = samples.filter((sample) => at - sample.at < windowMs);
      }
    },
    snapshot: ({ doneBytes, totalBytes }: { doneBytes: number; totalBytes: number }) => {
      const current = now();
      const elapsedMs = Math.min(current - startedAt, windowMs);
      const windowBytes = samples
        .filter((sample) => current - sample.at < windowMs)
        .reduce((sum, sample) => sum + sample.bytes, 0);
      const bytesPerSecond =
        elapsedMs >= MIN_SPEED_SAMPLE_MS && windowBytes > 0
          ? windowBytes / (elapsedMs / 1000)
          : null;

      return {
        bytesPerSecond,
        stalled: elapsedMs >= windowMs && windowBytes <= 0,
        etaSeconds:
          bytesPerSecond === null ? null : Math.max(totalBytes - doneBytes, 0) / bytesPerSecond,
        percent: totalBytes === 0 ? 100 : (doneBytes / totalBytes) * 100,
      };
    },
  };
};

export const formatBytes = (bytes: number) => {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const formatMbps = (bytesPerSecond: number) =>
  `${((bytesPerSecond * 8) / 1_000_000).toFixed(1)} Mbps`;

export const formatDuration = (seconds: number) => {
  const total = Math.ceil(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${total % 60}s`;
  }
  return `${total}s`;
};
