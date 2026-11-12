import { describe, expect, test } from "bun:test";
import { resolveLocationSharing } from "./locationSharing.ts";
import type { SharingPreference } from "./locationSharingTypes.ts";

const enabled: SharingPreference = {
  sharingPaused: false,
  sharingPausedUntil: null,
  sharingChangedAt: null,
  sharingRevision: 0,
};
const now = Date.parse("2026-11-12T12:00:00Z");

describe("location sharing preferences", () => {
  test("leaves an unpaused device sharing with its existing point IDs", () => {
    expect(resolveLocationSharing(enabled, enabled, now)).toEqual({
      paused: false,
      pausedUntil: null,
      resumeAfter: null,
      revisionPrefix: "",
    });
  });

  test("keeps a tablet paused after an account pause ends", () => {
    const tablet = {
      ...enabled,
      sharingPaused: true,
      sharingRevision: 1,
      sharingChangedAt: new Date(now - 1000),
    };
    const account = { ...enabled, sharingRevision: 2, sharingChangedAt: new Date(now) };
    expect(resolveLocationSharing(account, tablet, now)).toEqual({
      paused: true,
      pausedUntil: null,
      resumeAfter: new Date(now),
      revisionPrefix: "s2.1:",
    });
    expect(resolveLocationSharing(account, enabled, now).paused).toBe(false);
  });

  test("uses the later deadline and respects an indefinite pause", () => {
    const account = {
      ...enabled,
      sharingPaused: true,
      sharingPausedUntil: new Date(now + 60_000),
      sharingRevision: 1,
    };
    const tablet = { ...account, sharingPausedUntil: new Date(now + 120_000) };
    expect(resolveLocationSharing(account, tablet, now).pausedUntil).toEqual(
      tablet.sharingPausedUntil,
    );
    expect(
      resolveLocationSharing(account, { ...tablet, sharingPausedUntil: null }, now).pausedUntil,
    ).toBeNull();
  });

  test("expires exactly at the deadline and retains the fresh-location cutoff", () => {
    const timed = {
      ...enabled,
      sharingPaused: true,
      sharingRevision: 1,
      sharingChangedAt: new Date(now - 60_000),
      sharingPausedUntil: new Date(now),
    };
    expect(resolveLocationSharing(enabled, timed, now - 1).paused).toBe(true);
    expect(resolveLocationSharing(enabled, timed, now)).toEqual({
      paused: false,
      pausedUntil: null,
      resumeAfter: new Date(now),
      revisionPrefix: "s0.1:",
    });
  });
});
