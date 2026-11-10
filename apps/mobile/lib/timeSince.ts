const pluralize = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;

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
  if (elapsedSeconds < 60) {
    return `${pluralize(elapsedSeconds, "second")} ago`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const remainingMinutes = minutes % 60;
  if (days > 0) {
    return `${pluralize(days, "day")}, ${pluralize(hours, "hour")} and ${pluralize(remainingMinutes, "minute")} ago`;
  }
  if (hours > 0) {
    return `${pluralize(hours, "hour")} and ${pluralize(remainingMinutes, "minute")} ago`;
  }
  return `${pluralize(minutes, "minute")} ago`;
};

export const getTimeSinceRefreshIntervalMs = (
  input: Date | string | number,
  now: number = Date.now(),
): number => {
  const elapsedSeconds = elapsedSecondsSince(input, now);
  if (elapsedSeconds === null || elapsedSeconds < 0) {
    return 1_000;
  }
  const interval = elapsedSeconds < 60 ? 1_000 : 60_000;
  return interval - ((now - new Date(input).getTime()) % interval);
};

export const shortTimeSince = (input: Date | string | number, now: number = Date.now()) => {
  const elapsedSeconds = elapsedSecondsSince(input, now);
  if (elapsedSeconds === null || elapsedSeconds < 60) {
    return "now";
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};
