import { expect, test } from "bun:test";
import { GroupRole } from "@openbeacon/database/enums";
import { inviteMemberToGroupSchema } from "./inviteMember.ts";

test("invite emails are normalised to match how accounts store them", () => {
  const result = inviteMemberToGroupSchema.parse({
    groupId: "group",
    invites: [{ email: " Alice@Example.COM ", role: GroupRole.MEMBER }],
  });
  expect(result.invites[0]?.email).toBe("alice@example.com");
});
