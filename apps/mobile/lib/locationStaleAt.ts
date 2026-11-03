export const locationStaleAt = (timestamp: string) => Date.parse(timestamp) + 10 * 60_000 + 1;
