import { describe, expect, test } from "bun:test";
import { groupLimitAlert } from "./groupLimitAlert.ts";

describe("groupLimitAlert", () => {
  test("explains the group limit when the server refuses with GROUP_LIMIT_REACHED", () => {
    expect(
      groupLimitAlert({
        message: "An account can be in at most 16 groups.",
        data: { code: "PRECONDITION_FAILED", reason: "GROUP_LIMIT_REACHED" },
      }),
    ).toEqual({
      title: "Too many groups",
      message:
        "You're already in as many groups as your account allows. Leave a group before creating or joining another.",
    });
  });

  test("leaves other errors to the screen", () => {
    expect(groupLimitAlert({ data: { code: "PRECONDITION_FAILED", reason: null } })).toBeNull();
    expect(groupLimitAlert({ data: { code: "FORBIDDEN", reason: "NOT_GROUP_MEMBER" } })).toBeNull();
    expect(groupLimitAlert(new Error("Network request failed"))).toBeNull();
  });
});
