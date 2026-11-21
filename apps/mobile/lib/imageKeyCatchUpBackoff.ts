export const imageKeyCatchUpWaitMs = (misses: number) =>
  ([15, 15, 60, 6 * 60][misses] ?? 24 * 60) * 60_000;
