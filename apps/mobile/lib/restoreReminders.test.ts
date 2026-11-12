import { beforeEach, describe, expect, mock, test } from "bun:test";

const storageValues = new Map<string, number>();

mock.module("./storage.ts", () => ({
  storage: {
    getNumber: (key: string) => storageValues.get(key),
    set: (key: string, value: number) => {
      storageValues.set(key, value);
    },
  },
}));

const { dismissRestoreCard, isRestoreCardDismissed } = await import("./restoreReminders.ts");

describe("restore reminders", () => {
  beforeEach(() => {
    storageValues.clear();
  });

  test("dismissing the Account card hides it for that version until a newer one", () => {
    dismissRestoreCard({ userId: "user-1", version: 1 });

    expect(isRestoreCardDismissed({ userId: "user-1", version: 1 })).toBe(true);
    expect(isRestoreCardDismissed({ userId: "user-1", version: 2 })).toBe(false);
    expect(isRestoreCardDismissed({ userId: "user-2", version: 1 })).toBe(false);
  });

  test("a skipped sign-in prompt from an older app doesn't hide the Account card", () => {
    storageValues.set("recovery.restoreDeclined.user-1", 1);

    expect(isRestoreCardDismissed({ userId: "user-1", version: 1 })).toBe(false);
  });
});
