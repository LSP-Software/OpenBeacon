const TIME_UNITS = [
  { label: "year", seconds: 365 * 24 * 60 * 60 },
  { label: "month", seconds: Math.floor(30.44 * 24 * 60 * 60) },
  { label: "day", seconds: 24 * 60 * 60 },
  { label: "hour", seconds: 60 * 60 },
  { label: "minute", seconds: 60 },
] as const;

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function timeSince(input: Date | string | number): string {
  const date = new Date(input);
  const timestamp = date.getTime();

  if (Number.isNaN(timestamp)) {
    return "just now";
  }

  const elapsedSeconds = Math.floor((Date.now() - timestamp) / 1000);

  if (elapsedSeconds <= 0) {
    return "just now";
  }

  for (const unit of TIME_UNITS) {
    const value = Math.floor(elapsedSeconds / unit.seconds);
    if (value >= 1) {
      return pluralize(value, unit.label);
    }
  }

  return pluralize(elapsedSeconds, "second");
}
