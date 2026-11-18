export const limits = {
  historyDays: 14,
  groupsPerAccount: 16,
  activatedDevicesPerAccount: 3,
  seatsPerGroup: 64,
  dailyHistoryAllowance: 2_880,
  placesPerGroup: 50,
} as const;

export const maxAccountSeats = limits.groupsPerAccount * limits.seatsPerGroup;

export const historyRetentionMs = limits.historyDays * 24 * 60 * 60_000;
