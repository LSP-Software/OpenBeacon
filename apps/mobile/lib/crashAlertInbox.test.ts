import { describe, expect, test } from "bun:test";
import type { CrashAlertMessage } from "@openbeacon/encryption";
import {
  activeCrashFor,
  crashFocusSpot,
  crashHistoryItems,
  describeCrashNotice,
  emptyCrashInbox,
  receiveCrashAlerts,
} from "./crashAlertInbox.ts";

const minute = 60_000;
const crashAt = Date.UTC(2026, 10, 24, 18, 4);
const time = (ms: number) => {
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
};
const words = { name: () => "Sam", speed: (mps: number) => `${Math.round(mps * 2.237)} mph`, time };

const crash = (overrides: Partial<CrashAlertMessage> & { at?: number } = {}): CrashAlertMessage => {
  const id = overrides.alertId ?? "a".repeat(32);
  return {
    type: "CRASH",
    messageId: id,
    alertId: id,
    crash: {
      time: overrides.at ?? crashAt,
      latitude: 51.65,
      longitude: -0.2,
      speedBefore: 18.78,
    },
    sharingUntil: crashAt + 16 * minute,
    okAt: null,
    placeLabel: "Barnet Lane, EN5",
    ...overrides,
  };
};

const ok = (alertId: string, okAt: number): CrashAlertMessage => ({
  ...crash({ alertId }),
  type: "OK",
  messageId: `${alertId.slice(0, 31)}f`,
  okAt,
});

const received = (
  message: CrashAlertMessage,
  receivedAt: number,
  { deviceName = "Sam's Phone", groupId = "family", userId = "sam" } = {},
) => ({ deviceName, groupId, message, receivedAt, userId });

describe("receiving Crash alerts", () => {
  test("a new alert raises one alarm notification with the time, place and speed", () => {
    const { inbox, notices } = receiveCrashAlerts(emptyCrashInbox, [
      received(crash(), crashAt + minute),
    ]);
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    if (!notice) throw new Error("No notice.");
    expect(notice.kind).toBe("crash");
    expect(describeCrashNotice(notice.incident, words)).toEqual({
      title: "Sam: possible crash",
      body: "At 18:04 near Barnet Lane, EN5, 42 mph just before. Tap to see where Sam is now.",
    });
    expect(inbox.incidents).toHaveLength(1);
  });

  test("the same alert arriving through a second Group isn't shown twice", () => {
    const first = receiveCrashAlerts(emptyCrashInbox, [received(crash(), crashAt + minute)]);
    const second = receiveCrashAlerts(first.inbox, [
      received(crash(), crashAt + minute, { groupId: "work" }),
    ]);
    expect(second.notices).toEqual([]);
    expect(second.inbox.incidents).toHaveLength(1);
  });

  test("alerts from the same person within 5 minutes merge into one notification naming both devices", () => {
    const first = receiveCrashAlerts(emptyCrashInbox, [received(crash(), crashAt + minute)]);
    const tablet = crash({ alertId: "b".repeat(32), at: crashAt + 4 * minute });
    const merged = receiveCrashAlerts(first.inbox, [
      received(tablet, crashAt + 5 * minute, { deviceName: "Sam's Tablet" }),
    ]);
    expect(merged.inbox.incidents).toHaveLength(1);
    const [notice] = merged.notices;
    if (!notice) throw new Error("No notice.");
    expect(notice.key).toEqual(first.notices[0]?.key ?? "");
    expect(describeCrashNotice(notice.incident, words).body).toBe(
      "At 18:04 near Barnet Lane, EN5, 42 mph just before. Sent by Sam's Phone and Sam's Tablet.",
    );

    const later = crash({ alertId: "c".repeat(32), at: crashAt + 6 * minute });
    const separate = receiveCrashAlerts(merged.inbox, [received(later, crashAt + 7 * minute)]);
    expect(separate.inbox.incidents).toHaveLength(2);
    const otherPerson = receiveCrashAlerts(merged.inbox, [
      received(crash({ alertId: "d".repeat(32) }), crashAt + minute, { userId: "jo" }),
    ]);
    expect(otherPerson.inbox.incidents).toHaveLength(2);
  });

  test("a late alert leads with the crash time and says when it was sent", () => {
    const { notices } = receiveCrashAlerts(emptyCrashInbox, [
      received(crash({ at: crashAt + 2 * minute }), crashAt + 27 * minute),
    ]);
    const [notice] = notices;
    if (!notice) throw new Error("No notice.");
    expect(describeCrashNotice(notice.incident, words)).toEqual({
      title: "Sam: possible crash at 18:06",
      body: "Sent at 18:31, after Sam's Phone had no signal. Near Barnet Lane, EN5, 42 mph just before.",
    });
  });

  test("an OK after a late alert turns the alert green and gets its own notice", () => {
    const late = receiveCrashAlerts(emptyCrashInbox, [received(crash(), crashAt + 30 * minute)]);
    const { inbox, notices } = receiveCrashAlerts(late.inbox, [
      received(ok("a".repeat(32), crashAt + 31 * minute), crashAt + 32 * minute),
    ]);
    expect(notices.map(({ kind }) => kind)).toEqual(["ok"]);
    const [notice] = notices;
    if (!notice) throw new Error("No notice.");
    expect(describeCrashNotice(notice.incident, words, "ok")).toEqual({
      title: "Sam says they’re OK",
      body: "After a possible crash at 18:04.",
    });
    expect(activeCrashFor(inbox, "sam", crashAt + 40 * minute)?.ok).toEqual({
      at: crashAt + 31 * minute,
    });
  });

  test("an OK that arrives before its alert still shows, with the crash it follows", () => {
    const { inbox, notices } = receiveCrashAlerts(emptyCrashInbox, [
      received(ok("a".repeat(32), crashAt + 3 * minute), crashAt + 4 * minute),
    ]);
    expect(notices.map(({ kind }) => kind)).toEqual(["ok"]);
    const after = receiveCrashAlerts(inbox, [received(crash(), crashAt + 5 * minute)]);
    expect(after.notices).toEqual([]);
    expect(after.inbox.incidents).toHaveLength(1);
  });

  test("the person card shows a crash for two hours after the last news", () => {
    const { inbox } = receiveCrashAlerts(emptyCrashInbox, [received(crash(), crashAt + minute)]);
    expect(activeCrashFor(inbox, "sam", crashAt + 2 * 60 * minute)).not.toBeNull();
    expect(activeCrashFor(inbox, "sam", crashAt + 2 * 60 * minute + minute + 1)).toBeNull();
    expect(activeCrashFor(inbox, "jo", crashAt + minute)).toBeNull();
  });

  test("Group History gets one entry per sent alert and per OK, with late ones marked", () => {
    const items = crashHistoryItems(
      [
        received(crash(), crashAt + minute),
        received(
          crash({ alertId: "b".repeat(32), at: crashAt + 2 * minute }),
          crashAt + 27 * minute,
          {
            deviceName: "Sam's Tablet",
          },
        ),
        received(ok("a".repeat(32), crashAt + 5 * minute), crashAt + 5 * minute),
      ],
      words,
      (_personId, deviceName) => `Sam ${deviceName.slice(6)}`,
    );
    expect(items.map(({ at, text }) => ({ at: at.getTime(), text }))).toEqual([
      {
        at: crashAt + 27 * minute,
        text: "Sam Tablet sent a Crash alert: possible crash at 18:06 near Barnet Lane, EN5 (arrived 18:31, after no signal)",
      },
      { at: crashAt + 5 * minute, text: "Sam says they’re OK" },
      {
        at: crashAt + minute,
        text: "Sam Phone sent a Crash alert: possible crash at 18:04 near Barnet Lane, EN5",
      },
    ]);
  });
});

describe("crashFocusSpot", () => {
  const incident = receiveCrashAlerts(emptyCrashInbox, [received(crash(), crashAt + minute)]).inbox
    .incidents[0];
  if (!incident) throw new Error("no incident");

  test("a person last seen before the crash is shown at the crash spot", () => {
    expect(
      crashFocusSpot(incident, { timestamp: new Date(crashAt - minute).toISOString() }),
    ).toEqual({ latitude: 51.65, longitude: -0.2 });
  });

  test("a person seen since the crash is shown where they are", () => {
    expect(crashFocusSpot(incident, { timestamp: new Date(crashAt + 10_000).toISOString() })).toBe(
      null,
    );
  });

  test("a person with no known time is shown at the crash spot", () => {
    expect(crashFocusSpot(incident, { timestamp: null })).toEqual({
      latitude: 51.65,
      longitude: -0.2,
    });
  });
});
