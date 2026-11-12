import { storage } from "./storage.ts";

const cardDismissedKey = (userId: string) => `recovery.restoreCardDismissed.${userId}`;

const isHiddenFor = (key: string, version: number) => (storage.getNumber(key) ?? 0) >= version;

export const dismissRestoreCard = ({ userId, version }: Reminder) => {
  storage.set(cardDismissedKey(userId), version);
};

export const isRestoreCardDismissed = ({ userId, version }: Reminder) =>
  isHiddenFor(cardDismissedKey(userId), version);

type Reminder = { userId: string; version: number };
