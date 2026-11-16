import { describe, expect, test } from "bun:test";
import { announcementSchema, appVersionSchema, compareAppVersions } from "./announcement.ts";

describe("compareAppVersions", () => {
  test.each([
    ["1.2.3", "1.2.3", 0],
    ["1.10.0", "1.9.9", 1],
    ["1.9.9", "1.10.0", -1],
    ["2.0.0", "1.99.99", 1],
    ["1.2.3", "1.2.10", -1],
  ])("compares %s with %s numerically, not as text", (left, right, expected) => {
    expect(compareAppVersions(left, right)).toBe(expected);
  });
});

describe("appVersionSchema", () => {
  test.each(["1.2.3", "0.0.1", "10.20.30"])("accepts %s", (version) => {
    expect(appVersionSchema.safeParse(version).success).toBe(true);
  });

  test.each(["1.2", "1.2.3-beta", "v1.2.3", "1.2.3.4", ""])("rejects %s", (version) => {
    expect(appVersionSchema.safeParse(version).success).toBe(false);
  });
});

describe("announcementSchema", () => {
  const announcement = {
    id: "0196a1b2-0000-7000-8000-000000000000",
    message: "Planned maintenance on Saturday.",
    severity: "warning",
    platform: null,
    minAppVersion: null,
    maxAppVersion: "1.20.0",
    downtimeStartsAt: "2026-11-21T09:00:00.000Z",
    downtimeEndsAt: "2026-11-21T10:00:00.000Z",
    endsAt: "2026-11-21T10:00:00.000Z",
  };

  test("accepts what the server sends", () => {
    expect(announcementSchema.parse(announcement)).toEqual(announcement);
  });

  test("rejects a message over 280 characters", () => {
    expect(
      announcementSchema.safeParse({ ...announcement, message: "a".repeat(281) }).success,
    ).toBe(false);
  });

  test("accepts exactly 280 characters", () => {
    expect(
      announcementSchema.safeParse({ ...announcement, message: "a".repeat(280) }).success,
    ).toBe(true);
  });

  test("accepts emoji joined with a zero width joiner", () => {
    const message = "Back soon \u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(announcementSchema.parse({ ...announcement, message }).message).toBe(message);
  });

  test.each([
    ["a newline", "Line one\nLine two"],
    ["a tab", "Down\tsoon"],
    ["a null byte", "Down\u0000soon"],
    ["a delete character", "Down\u007Fsoon"],
    ["an Arabic letter mark", "Down\u061Csoon"],
    ["a left-to-right mark", "Down\u200Esoon"],
    ["a right-to-left mark", "Down\u200Fsoon"],
    ["a right-to-left override", "Down\u202Esoon"],
    ["a left-to-right embedding", "Down\u202Asoon"],
    ["a first strong isolate", "Down\u2068soon"],
    ["a pop directional isolate", "Down\u2069soon"],
  ])("rejects a message with %s", (_name, message) => {
    expect(announcementSchema.safeParse({ ...announcement, message }).success).toBe(false);
  });

  test("rejects a platform it doesn't know", () => {
    expect(announcementSchema.safeParse({ ...announcement, platform: "web" }).success).toBe(false);
  });
});
