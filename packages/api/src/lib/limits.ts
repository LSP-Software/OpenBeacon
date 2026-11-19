import { MAX_PLACES_PER_GROUP } from "@openbeacon/schemas";

export const limits = {
  historyDays: 30,
  groupsPerAccount: 16,
  devicesPerAccount: 10,
  seatsPerGroup: 64,
  dailyHistoryAllowance: 2_880,
  placesPerGroup: MAX_PLACES_PER_GROUP,
} as const;

export const maxAccountSeats = limits.groupsPerAccount * limits.seatsPerGroup;

export const historyRetentionMs = limits.historyDays * 24 * 60 * 60_000;
