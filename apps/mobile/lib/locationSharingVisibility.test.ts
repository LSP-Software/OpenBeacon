import { expect, test } from "bun:test";
import type { GroupDeviceSharingState } from "@openbeacon/shared";
import { canShowSharedLocation } from "./locationSharingVisibility.ts";

const tablet: GroupDeviceSharingState = {
  deviceId: "tablet",
  userId: "alex",
  paused: true,
  revisionPrefix: "s0.1:",
};

test("hides a paused tablet while leaving its owner's phone visible", () => {
  expect(canShowSharedLocation({ deviceId: "tablet" }, [tablet])).toBe(false);
  expect(canShowSharedLocation({ deviceId: "phone" }, [tablet])).toBe(true);
});

test("a resumed tablet appears again", () => {
  expect(
    canShowSharedLocation({ deviceId: "tablet" }, [
      { ...tablet, paused: false, revisionPrefix: "s0.2:" },
    ]),
  ).toBe(true);
});
