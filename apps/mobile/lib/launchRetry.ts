export const launchRetryDelayMs = (failures: number) =>
  failures <= 1 ? 5_000 : failures === 2 ? 15_000 : 60_000;
