export const HISTORY_SHARES = ["LAST_LOCATION", "HOURS_6", "DAY_1", "WEEK_1", "MAXIMUM"] as const;

export type HistoryShare = (typeof HISTORY_SHARES)[number];

export const historyShareHours: Record<HistoryShare, number | null> = {
  LAST_LOCATION: 0,
  HOURS_6: 6,
  DAY_1: 24,
  WEEK_1: 168,
  MAXIMUM: null,
};

export const resolveHistoryShare = ({
  account,
  group,
}: {
  account: HistoryShare;
  group: HistoryShare | null;
}) => group ?? account;

export const historyShareFirstHour = (share: HistoryShare, nowHour: number) => {
  const hours = historyShareHours[share];
  return hours === null ? null : nowHour - hours + 1;
};

export const isShorterHistoryShare = (next: HistoryShare, previous: HistoryShare) =>
  HISTORY_SHARES.indexOf(next) < HISTORY_SHARES.indexOf(previous);
