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

const { dismissRestoreCard, isRestoreCardDismissed, isRestorePromptSkipped, skipRestorePrompt } =
  await import("./restoreReminders.ts");

describe("restore reminders", () => {
  beforeEach(() => {
    storageValues.clear();
  });

  test("skipping the sign-in prompt hides it for that version until a newer one", () => {
    skipRestorePrompt({ userId: "user-1", version: 1 });

    expect(isRestorePromptSkipped({ userId: "user-1", version: 1 })).toBe(true);
    expect(isRestorePromptSkipped({ userId: "user-1", version: 2 })).toBe(false);
    expect(isRestorePromptSkipped({ userId: "user-2", version: 1 })).toBe(false);
  });

  test("dismissing the Account card hides it for that version until a newer one", () => {
    dismissRestoreCard({ userId: "user-1", version: 1 });

    expect(isRestoreCardDismissed({ userId: "user-1", version: 1 })).toBe(true);
    expect(isRestoreCardDismissed({ userId: "user-1", version: 2 })).toBe(false);
    expect(isRestoreCardDismissed({ userId: "user-2", version: 1 })).toBe(false);
  });

  test("skipping the sign-in prompt leaves the Account card visible", () => {
    skipRestorePrompt({ userId: "user-1", version: 1 });

    expect(isRestoreCardDismissed({ userId: "user-1", version: 1 })).toBe(false);
  });

  test("dismissing the Account card leaves the sign-in prompt to show", () => {
    dismissRestoreCard({ userId: "user-1", version: 1 });

    expect(isRestorePromptSkipped({ userId: "user-1", version: 1 })).toBe(false);
  });

  test("a value stored before the reminders were split only hides the sign-in prompt", () => {
    storageValues.set("recovery.restoreDeclined.user-1", 1);

    expect(isRestorePromptSkipped({ userId: "user-1", version: 1 })).toBe(true);
    expect(isRestoreCardDismissed({ userId: "user-1", version: 1 })).toBe(false);
  });
});
