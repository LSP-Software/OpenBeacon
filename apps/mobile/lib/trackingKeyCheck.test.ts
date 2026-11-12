import { afterEach, beforeEach, expect, mock, setSystemTime, test } from "bun:test";

const storageValues = new Map<string, string>();

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    remove: (key: string) => storageValues.delete(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

const {
  clearTrackingKeyCheck,
  isTrackingKeyCheckDue,
  noteTrackingKeyState,
  recordTrackingKeyCheck,
} = await import("./trackingKeyCheck.ts");

const minutes = (count: number) => count * 60_000;
const start = new Date("2026-11-12T10:00:00.000Z").getTime();

beforeEach(() => {
  storageValues.clear();
  setSystemTime(start);
  clearTrackingKeyCheck();
});

afterEach(() => {
  setSystemTime();
});

test("a key check is due after 4 minutes when uploads report no key state", () => {
  recordTrackingKeyCheck({ membership: "", scope: "scope" });
  setSystemTime(start + minutes(3));
  expect(isTrackingKeyCheckDue("scope")).toBe(false);
  setSystemTime(start + minutes(4));
  expect(isTrackingKeyCheckDue("scope")).toBe(true);
});

test("recent key states from uploads stretch the key check to 30 minutes", () => {
  recordTrackingKeyCheck({ membership: "", scope: "scope" });
  for (let minute = 0; minute < 30; minute += 5) {
    setSystemTime(start + minutes(minute));
    noteTrackingKeyState("state");
    expect(isTrackingKeyCheckDue("scope")).toBe(false);
  }
  setSystemTime(start + minutes(30));
  expect(isTrackingKeyCheckDue("scope")).toBe(true);
});

test("an old key state falls back to the 4 minute check", () => {
  noteTrackingKeyState("state");
  setSystemTime(start + minutes(11));
  recordTrackingKeyCheck({ membership: "", scope: "scope" });
  setSystemTime(start + minutes(15));
  expect(isTrackingKeyCheckDue("scope")).toBe(true);
});

test("a changed key state makes the key check due straight away", () => {
  recordTrackingKeyCheck({ membership: "", scope: "scope" });
  expect(noteTrackingKeyState("state-1")).toBe(false);
  expect(noteTrackingKeyState("state-1")).toBe(false);
  expect(isTrackingKeyCheckDue("scope")).toBe(false);
  expect(noteTrackingKeyState("state-2")).toBe(true);
  expect(isTrackingKeyCheckDue("scope")).toBe(true);
});

test("a different scope is always due", () => {
  recordTrackingKeyCheck({ membership: "", scope: "scope" });
  expect(isTrackingKeyCheckDue("other")).toBe(true);
});

test("signing out forgets the key state", () => {
  noteTrackingKeyState("state-1");
  clearTrackingKeyCheck();
  expect(noteTrackingKeyState("state-2")).toBe(false);
});
