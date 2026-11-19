import { describe, expect, test } from "bun:test";
import { createGroupSchema, newGroupIdSchema } from "./create.ts";

describe("createGroupSchema", () => {
  test("trims group names and enforces the same length limits as rename", () => {
    expect(createGroupSchema.parse({ name: " Family " }).name).toBe("Family");
    expect(createGroupSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: "a".repeat(100) }).success).toBe(true);
    expect(createGroupSchema.safeParse({ name: "a".repeat(101) }).success).toBe(false);
  });

  test("refuses control characters the database can't store or a notification would break on", () => {
    for (const name of ["A\u0000B", "Fam\nily", "Tab\tbed"]) {
      expect(createGroupSchema.safeParse({ name }).success).toBe(false);
    }
    expect(createGroupSchema.parse({ name: "李 O’Connor" }).name).toBe("李 O’Connor");
  });

  test("refuses direction overrides and isolates, and names with nothing visible", () => {
    for (const name of ["Family\u202E", "\u2067Family\u2069", "\u200B", "\u2060\u200D"]) {
      expect(createGroupSchema.safeParse({ name }).success).toBe(false);
    }
    expect(createGroupSchema.parse({ name: "\u05DE\u05E9\u05E4\u05D7\u05D4\u200F" }).name).toBe(
      "\u05DE\u05E9\u05E4\u05D7\u05D4\u200F",
    );
  });
});

test("new group IDs are safe path segments", () => {
  expect(newGroupIdSchema.safeParse("group_550e8400-e29b-41d4-a716-446655440000").success).toBe(
    true,
  );
  for (const id of ["", "../avatar", "group/other", "x".repeat(129)]) {
    expect(newGroupIdSchema.safeParse(id).success).toBe(false);
  }
});
