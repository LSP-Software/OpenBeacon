import {
  HISTORY_SHARES,
  isShorterHistoryShare,
  resolveHistoryShare,
  type HistoryShare,
} from "@openbeacon/shared";

const HOUR_MS = 3_600_000;

type HistoryShareSetting = {
  account: HistoryShare;
  groups: ReadonlyArray<{ groupId: string; historyShare: HistoryShare | null }>;
};

const choices: Record<HistoryShare, { label: string; amount: string; period: string | null }> = {
  LAST_LOCATION: { label: "Last location only", amount: "only your location now", period: null },
  HOURS_6: { label: "6 hours", amount: "6 hours of history", period: "the last 6 hours" },
  DAY_1: { label: "1 day", amount: "1 day of history", period: "the last day" },
  WEEK_1: { label: "1 week", amount: "1 week of history", period: "the last week" },
  MAXIMUM: { label: "Maximum (14 days)", amount: "up to 14 days of history", period: null },
};

export const historyShareChoices = HISTORY_SHARES.map((value) => ({
  value,
  label: choices[value].label,
}));

export const historyShareLabel = (share: HistoryShare) => choices[share].label;

export const historyShareAmount = (share: HistoryShare) => choices[share].amount;

export const historyShareNote = (name: string | null, share: HistoryShare) => {
  const period = choices[share].period;
  if (share === "LAST_LOCATION") {
    return name === null
      ? "You share only your location now"
      : `${name} shares only their location now`;
  }
  if (period === null) return null;
  return name === null ? `You share ${period}` : `${name} shares ${period}`;
};

export const groupHistoryShare = (setting: HistoryShareSetting, groupId: string) => {
  const override = setting.groups.find((group) => group.groupId === groupId)?.historyShare ?? null;
  return { override, share: resolveHistoryShare({ account: setting.account, group: override }) };
};

export const shortensHistory = ({
  groupIds,
  next,
  setting,
}: {
  groupIds: readonly string[];
  next: { account: HistoryShare } | { groupId: string; override: HistoryShare | null };
  setting: HistoryShareSetting;
}) =>
  groupIds.some((groupId) => {
    const { override, share } = groupHistoryShare(setting, groupId);
    const after =
      "account" in next
        ? resolveHistoryShare({ account: next.account, group: override })
        : next.groupId === groupId
          ? resolveHistoryShare({ account: setting.account, group: next.override })
          : share;
    return isShorterHistoryShare(after, share);
  });

export const senderHistoryStart = (
  senders: ReadonlyArray<{ firstHour: number | null; userId: string }>,
  userId: string,
) => {
  const firstHour = senders.find((sender) => sender.userId === userId)?.firstHour ?? null;
  return firstHour === null ? null : firstHour * HOUR_MS;
};
