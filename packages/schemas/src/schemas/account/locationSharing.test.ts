import { expect, test } from "bun:test";
import { setLocationSharingSchema } from "./locationSharing.ts";

const change = {
  requestId: "sharing-1",
  expectedRevision: 0,
  replacesRequestId: null,
  paused: true,
  durationMinutes: null,
  pausedUntil: null,
};

test("sharing changes must name their account and device changes must name their device", () => {
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
      ...change,
      scope: "device",
      expectedUserId: "alex",
      deviceId: "tablet",
      durationMinutes: 5,
      pausedUntil: new Date(),
    }).success,
  ).toBe(false);
});

test("a timed pause carries the end time chosen when it was tapped", () => {
  const account = { ...change, scope: "account", expectedUserId: "alex" };
  expect(setLocationSharingSchema.safeParse({ ...account, durationMinutes: 15 }).success).toBe(
    false,
  );
  expect(setLocationSharingSchema.safeParse({ ...account, pausedUntil: new Date() }).success).toBe(
    false,
  );
  expect(
    setLocationSharingSchema.safeParse({
      ...account,
      durationMinutes: 15,
      pausedUntil: new Date(),
    }).success,
  ).toBe(true);
});

test("a resume carries no end time and must say what it replaces", () => {
  const resume = {
    ...change,
    scope: "account",
    expectedUserId: "alex",
    paused: false,
  };
  expect(setLocationSharingSchema.safeParse(resume).success).toBe(true);
  expect(
    setLocationSharingSchema.safeParse({
      ...resume,
      durationMinutes: 15,
      pausedUntil: new Date(),
    }).success,
  ).toBe(false);
  expect(setLocationSharingSchema.safeParse({ ...resume, expectedRevision: null }).success).toBe(
    false,
  );
  expect(
    setLocationSharingSchema.safeParse({
      ...resume,
      expectedRevision: null,
      replacesRequestId: "sharing-0",
    }).success,
  ).toBe(true);
});
