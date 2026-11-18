import {
  HISTORY_SHARES,
  isShorterHistoryShare,
  resolveHistoryShare,
  type HistoryShare,
} from "@openbeacon/shared";
import type { HistoryShareChange } from "./historyShareTypes.ts";
import type { TimelineSender } from "./timelineTypes.ts";

type HistoryShareSetting = {
  account: HistoryShare;
  groups: ReadonlyArray<{ groupId: string; historyShare: HistoryShare | null }>;
};

const choices: Record<
  Exclude<HistoryShare, "MAXIMUM">,
  { label: string; amount: string; period: string | null }
> = {
  LAST_LOCATION: { label: "Last location only", amount: "only your location now", period: null },
  HOURS_6: { label: "6 hours", amount: "6 hours of history", period: "the last 6 hours" },
  DAY_1: { label: "1 day", amount: "1 day of history", period: "the last day" },
  WEEK_1: { label: "1 week", amount: "1 week of history", period: "the last week" },
};

export const serverHistoryDays = ({ historyDays }: { historyDays?: number }) => historyDays ?? 14;

export const historyShareLabel = (share: HistoryShare, historyDays: number) =>
  share === "MAXIMUM" ? `Maximum (${historyDays} days)` : choices[share].label;

export const historyShareChoices = (historyDays: number) =>
  HISTORY_SHARES.map((value) => ({ value, label: historyShareLabel(value, historyDays) }));

export const historyShareAmount = (share: HistoryShare, historyDays: number) =>
  share === "MAXIMUM" ? `up to ${historyDays} days of history` : choices[share].amount;

export const historyShareNote = (name: string | null, share: HistoryShare) => {
  if (share === "MAXIMUM") return null;
  if (share === "LAST_LOCATION") {
    return name === null
      ? "You share only your location now"
      : `${name} shares only their location now`;
  }
  const period = choices[share].period;
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
  next: HistoryShareChange;
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

export const senderHistoryStart = (senders: readonly TimelineSender[], userId: string) => {
  const firstHour = senders.find((sender) => sender.userId === userId)?.firstHour ?? null;
  return firstHour === null ? null : firstHour * 3_600_000;
};
