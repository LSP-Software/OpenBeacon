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
  test("only Admins change roles, never the owner's or their own", () => {
    expect(actionsFor(owner, admin).changeRole).toBe(true);
    expect(actionsFor(owner, editor).changeRole).toBe(true);
    expect(actionsFor(admin, member).changeRole).toBe(true);
    expect(actionsFor(admin, otherAdmin).changeRole).toBe(true);
    expect(actionsFor(admin, owner).changeRole).toBe(false);
    expect(actionsFor(admin, admin).changeRole).toBe(false);
    expect(actionsFor(editor, member).changeRole).toBe(false);
    expect(actionsFor(member, otherMember).changeRole).toBe(false);
  });

  test("Admins remove anyone but the owner", () => {
    expect(actionsFor(admin, otherAdmin).leaveOrRemove).toBe(true);
    expect(actionsFor(admin, editor).leaveOrRemove).toBe(true);
    expect(actionsFor(admin, member).leaveOrRemove).toBe(true);
    expect(actionsFor(admin, owner).leaveOrRemove).toBe(false);
    expect(actionsFor(owner, admin).leaveOrRemove).toBe(true);
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
      changeRole: false,
      makeOwner: false,
      leaveOrRemove: false,
    });
  });
});
