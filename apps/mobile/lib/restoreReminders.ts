import { storage } from "./storage.ts";

const promptSkippedKey = (userId: string) => `recovery.restoreDeclined.${userId}`;
const cardDismissedKey = (userId: string) => `recovery.restoreCardDismissed.${userId}`;

const isHiddenFor = (key: string, version: number) => (storage.getNumber(key) ?? 0) >= version;

export const skipRestorePrompt = ({ userId, version }: Reminder) => {
  storage.set(promptSkippedKey(userId), version);
};

export const isRestorePromptSkipped = ({ userId, version }: Reminder) =>
  isHiddenFor(promptSkippedKey(userId), version);

export const dismissRestoreCard = ({ userId, version }: Reminder) => {
  storage.set(cardDismissedKey(userId), version);
};

export const isRestoreCardDismissed = ({ userId, version }: Reminder) =>
  isHiddenFor(cardDismissedKey(userId), version);

type Reminder = { userId: string; version: number };
