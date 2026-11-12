import { expect, test } from "bun:test";
import type { DeviceSharingState } from "@openbeacon/shared";
import { canShowSharedLocation } from "./locationSharingVisibility.ts";

const cutoff = new Date("2026-11-12T12:00:00Z");
const tablet: DeviceSharingState = {
  deviceId: "tablet",
  userId: "alex",
  paused: true,
  pausedUntil: null,
  resumeAfter: cutoff,
  revisionPrefix: "s0.1:",
};

test("hides a paused tablet while leaving its owner's phone visible", () => {
  expect(
    canShowSharedLocation(
      { deviceId: "tablet", timestamp: new Date(cutoff.getTime() + 1000).toISOString() },
      [tablet],
    ),
  ).toBe(false);
  expect(
    canShowSharedLocation({ deviceId: "phone", timestamp: cutoff.toISOString() }, [tablet]),
  ).toBe(true);
});

test("resuming waits for a fresh fix and never restores the previous pin", () => {
  const sharing = [{ ...tablet, paused: false }];
  expect(canShowSharedLocation({ deviceId: "tablet", timestamp: null }, sharing)).toBe(false);
  expect(
    canShowSharedLocation({ deviceId: "tablet", timestamp: cutoff.toISOString() }, sharing),
  ).toBe(false);
  expect(
    canShowSharedLocation(
      { deviceId: "tablet", timestamp: new Date(cutoff.getTime() + 1).toISOString() },
      sharing,
    ),
  ).toBe(true);
});
