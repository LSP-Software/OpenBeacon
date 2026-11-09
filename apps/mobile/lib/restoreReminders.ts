import { storage } from "./storage.ts";

const restoreDeclinedKey = (userId: string) => `recovery.restoreDeclined.${userId}`;

const isDeclinedFor = ({ userId, version }: Reminder) =>
  (storage.getNumber(restoreDeclinedKey(userId)) ?? 0) >= version;

const declineFor = ({ userId, version }: Reminder) => {
  storage.set(restoreDeclinedKey(userId), version);
};

export const skipRestorePrompt = declineFor;
export const isRestorePromptSkipped = isDeclinedFor;
export const dismissRestoreCard = declineFor;
export const isRestoreCardDismissed = isDeclinedFor;

type Reminder = { userId: string; version: number };
