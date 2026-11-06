import { describe, expect, test } from "bun:test";
import { createGroupSchema } from "./create.ts";

describe("createGroupSchema", () => {
  test("trims group names and enforces the same length limits as rename", () => {
    expect(createGroupSchema.parse({ name: " Family " }).name).toBe("Family");
    expect(createGroupSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: "a".repeat(100) }).success).toBe(true);
    expect(createGroupSchema.safeParse({ name: "a".repeat(101) }).success).toBe(false);
  });
});
