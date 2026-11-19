import { describe, expect, test } from "bun:test";
import { type GroupRole, memberActions } from "./groupRoles.ts";

const owner = { id: "m-owner", role: "ADMIN", userId: "u-owner" } as const;
const admin = { id: "m-admin", role: "ADMIN", userId: "u-admin" } as const;
const otherAdmin = { id: "m-admin2", role: "ADMIN", userId: "u-admin2" } as const;
const editor = { id: "m-editor", role: "EDITOR", userId: "u-editor" } as const;
const otherEditor = { id: "m-editor2", role: "EDITOR", userId: "u-editor2" } as const;
const member = { id: "m-member", role: "MEMBER", userId: "u-member" } as const;
const otherMember = { id: "m-member2", role: "MEMBER", userId: "u-member2" } as const;

const actionsFor = (
  self: { id: string; role: GroupRole; userId: string },
  target: { id: string; role: GroupRole; userId: string },
) => memberActions({ ownerId: owner.userId, self, target });

describe("memberActions", () => {
  test("only the owner offers every role, including Admin", () => {
    expect(actionsFor(owner, admin).roleChoices).toEqual(["ADMIN", "EDITOR", "MEMBER"]);
    expect(actionsFor(owner, editor).roleChoices).toEqual(["ADMIN", "EDITOR", "MEMBER"]);
    expect(actionsFor(owner, member).roleChoices).toEqual(["ADMIN", "EDITOR", "MEMBER"]);
  });

  test("other Admins move people between Editor and Member but never touch Admins", () => {
    expect(actionsFor(admin, member).roleChoices).toEqual(["EDITOR", "MEMBER"]);
    expect(actionsFor(admin, editor).roleChoices).toEqual(["EDITOR", "MEMBER"]);
    expect(actionsFor(admin, otherAdmin).roleChoices).toEqual([]);
    expect(actionsFor(admin, owner).roleChoices).toEqual([]);
  });

  test("nobody changes their own role, and Editors and Members change nobody's", () => {
    for (const self of [owner, admin, editor, member]) {
      expect(actionsFor(self, self).roleChoices).toEqual([]);
    }
    expect(actionsFor(editor, member).roleChoices).toEqual([]);
    expect(actionsFor(member, otherMember).roleChoices).toEqual([]);
  });

  test("the owner removes anyone else, other Admins remove Editors and Members", () => {
    expect(actionsFor(owner, admin).leaveOrRemove).toBe(true);
    expect(actionsFor(owner, editor).leaveOrRemove).toBe(true);
    expect(actionsFor(owner, member).leaveOrRemove).toBe(true);
    expect(actionsFor(admin, editor).leaveOrRemove).toBe(true);
    expect(actionsFor(admin, member).leaveOrRemove).toBe(true);
    expect(actionsFor(admin, otherAdmin).leaveOrRemove).toBe(false);
    expect(actionsFor(admin, owner).leaveOrRemove).toBe(false);
  });

  test("Editors remove Members only", () => {
    expect(actionsFor(editor, member).leaveOrRemove).toBe(true);
    expect(actionsFor(editor, otherEditor).leaveOrRemove).toBe(false);
    expect(actionsFor(editor, admin).leaveOrRemove).toBe(false);
    expect(actionsFor(editor, owner).leaveOrRemove).toBe(false);
  });

  test("Members remove nobody but can always leave, as can everyone else", () => {
    expect(actionsFor(member, otherMember).leaveOrRemove).toBe(false);
    for (const self of [owner, admin, editor, member]) {
      expect(actionsFor(self, self).leaveOrRemove).toBe(true);
    }
  });

  test("Make owner only shows when the owner views another Admin", () => {
    expect(actionsFor(owner, admin).makeOwner).toBe(true);
    expect(actionsFor(owner, editor).makeOwner).toBe(false);
    expect(actionsFor(owner, member).makeOwner).toBe(false);
    expect(actionsFor(owner, owner).makeOwner).toBe(false);
    expect(actionsFor(admin, otherAdmin).makeOwner).toBe(false);
  });

  test("a phone without a membership gets no actions on others", () => {
    expect(memberActions({ ownerId: owner.userId, self: undefined, target: member })).toEqual({
      roleChoices: [],
      makeOwner: false,
      leaveOrRemove: false,
    });
  });
});
