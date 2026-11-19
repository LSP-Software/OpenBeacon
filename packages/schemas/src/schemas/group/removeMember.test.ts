import { expect, test } from "bun:test";
import { removeGroupMemberSchema } from "./removeMember.ts";

test("member IDs longer than any real ID are refused", () => {
  const long = "m".repeat(129);
  expect(removeGroupMemberSchema.safeParse({ groupId: "group", memberId: long }).success).toBe(
    false,
  );
  expect(
    removeGroupMemberSchema.safeParse({
      groupId: "group",
      memberId: "member",
      successorMemberId: long,
    }).success,
  ).toBe(false);
  expect(
    removeGroupMemberSchema.safeParse({
      groupId: "group",
      memberId: "m".repeat(128),
      successorMemberId: "s".repeat(128),
    }).success,
  ).toBe(true);
});
