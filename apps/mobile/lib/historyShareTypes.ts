import type { HistoryShare } from "@openbeacon/shared";

export type HistoryShareChange =
  { account: HistoryShare } | { groupId: string; override: HistoryShare | null };
