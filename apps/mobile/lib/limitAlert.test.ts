import { describe, expect, test } from "bun:test";
import { limitAlert } from "./limitAlert.ts";

describe("limitAlert", () => {
  test("explains the group limit when the server refuses with GROUP_LIMIT_REACHED", () => {
    expect(
      limitAlert({
        message: "An account can be in at most 16 groups.",
        data: { code: "PRECONDITION_FAILED", reason: "GROUP_LIMIT_REACHED" },
      }),
    ).toEqual({
      title: "Too many groups",
      message:
        "You're already in as many groups as your account allows. Leave a group before creating or joining another.",
    });
  });

  test("shows the server's message when the owner has no room or the group is full", () => {
    expect(
      limitAlert({
        message: "Your account has no seats. Add seats to create a group.",
        data: { code: "PRECONDITION_FAILED", reason: "NO_FREE_SEATS" },
      }),
    ).toEqual({
      title: "No room",
      message: "Your account has no seats. Add seats to create a group.",
    });
    expect(
      limitAlert({
        message: "This group is full. A group can have up to 64 phones.",
        data: { code: "PRECONDITION_FAILED", reason: "GROUP_FULL" },
      }),
    ).toEqual({
      title: "Group full",
      message: "This group is full. A group can have up to 64 phones.",
    });
  });

  test("leaves other errors to the screen", () => {
    expect(limitAlert({ data: { code: "PRECONDITION_FAILED", reason: null } })).toBeNull();
    expect(limitAlert({ data: { code: "FORBIDDEN", reason: "NOT_GROUP_MEMBER" } })).toBeNull();
    expect(limitAlert(new Error("Network request failed"))).toBeNull();
  });
});
