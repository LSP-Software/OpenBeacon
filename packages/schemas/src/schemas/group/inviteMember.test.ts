import { describe, expect, test } from "bun:test";
import { GroupRole } from "@openbeacon/database/enums";
import { inviteMemberToGroupSchema } from "./inviteMember.ts";

describe("inviteMemberToGroupSchema", () => {
  test("normalises invite emails to match how accounts store them", () => {
    const result = inviteMemberToGroupSchema.parse({
      groupId: "group",
      invites: [{ email: "Alice@Example.COM", role: GroupRole.MEMBER }],
    });
    expect(result.invites[0]?.email).toBe("alice@example.com");
  });

  test("rejects invalid emails", () => {
    const result = inviteMemberToGroupSchema.safeParse({
      groupId: "group",
      invites: [{ email: "not-an-email", role: GroupRole.MEMBER }],
    });
    expect(result.success).toBe(false);
  });
});
