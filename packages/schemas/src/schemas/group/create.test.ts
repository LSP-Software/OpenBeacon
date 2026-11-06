import { describe, expect, test } from "bun:test";
import { createGroupSchema, newGroupIdSchema } from "./create.ts";

describe("createGroupSchema", () => {
  test("trims group names and enforces the same length limits as rename", () => {
    expect(createGroupSchema.parse({ name: " Family " }).name).toBe("Family");
    expect(createGroupSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: "a".repeat(100) }).success).toBe(true);
    expect(createGroupSchema.safeParse({ name: "a".repeat(101) }).success).toBe(false);
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
