import { expect, test } from "bun:test";
import { setLocationSharingSchema } from "./locationSharing.ts";

test("sharing changes must name their account and device changes must name their device", () => {
  const change = { paused: true, durationMinutes: null };
  expect(setLocationSharingSchema.safeParse({ ...change, scope: "account" }).success).toBe(false);
  expect(
    setLocationSharingSchema.safeParse({ ...change, scope: "device", expectedUserId: "alex" })
      .success,
  ).toBe(false);
  expect(
    setLocationSharingSchema.safeParse({
      ...change,
      scope: "device",
      expectedUserId: "alex",
      deviceId: "tablet",
    }).success,
  ).toBe(true);
  expect(
    setLocationSharingSchema.safeParse({ ...change, scope: "account", expectedUserId: "alex" })
      .success,
  ).toBe(true);
});

test("sharing pauses reject unsupported durations", () => {
  expect(
    setLocationSharingSchema.safeParse({
      scope: "device",
      expectedUserId: "alex",
      deviceId: "tablet",
      paused: true,
      durationMinutes: 5,
    }).success,
  ).toBe(false);
});
