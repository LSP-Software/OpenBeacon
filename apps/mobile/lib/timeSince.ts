const TIME_UNITS = [
  { label: "year", seconds: 365 * 24 * 60 * 60 },
  { label: "month", seconds: Math.floor(30.44 * 24 * 60 * 60) },
  { label: "day", seconds: 24 * 60 * 60 },
  { label: "hour", seconds: 60 * 60 },
  { label: "minute", seconds: 60 },
] as const;

const pluralize = (value: number, unit: string): string => {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
};

const elapsedSecondsSince = (input: Date | string | number, now: number) => {
  const timestamp = new Date(input).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return Math.floor((now - timestamp) / 1000);
};

export const timeSince = (input: Date | string | number, now: number = Date.now()): string => {
  const elapsedSeconds = elapsedSecondsSince(input, now);

  if (elapsedSeconds === null || elapsedSeconds <= 0) {
    return "just now";
  }

  for (const unit of TIME_UNITS) {
    const value = Math.floor(elapsedSeconds / unit.seconds);
    if (value >= 1) {
      return pluralize(value, unit.label);
    }
  }

  return pluralize(elapsedSeconds, "second");
};

export const getTimeSinceRefreshIntervalMs = (
  input: Date | string | number,
  now: number = Date.now(),
): number => {
  const elapsedSeconds = elapsedSecondsSince(input, now);

  if (elapsedSeconds === null || elapsedSeconds < 60) {
    return 1_000;
  }
  if (elapsedSeconds < 60 * 60) {
    return 60_000;
  }
  if (elapsedSeconds < 24 * 60 * 60) {
    return 3_600_000;
  }
  return 86_400_000;
};
