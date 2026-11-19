import type { RouterOutputs } from "./api.ts";

export type GroupRole = RouterOutputs["groupMembership"]["list"][number]["members"][number]["role"];

export const groupRoles = ["ADMIN", "EDITOR", "MEMBER"] as const satisfies readonly GroupRole[];

export const roleLabel = (role: GroupRole) =>
  ({ ADMIN: "Admin", EDITOR: "Editor", MEMBER: "Member" })[role];

export const canEditGroup = (role: GroupRole | undefined) => role === "ADMIN" || role === "EDITOR";

export const memberActions = ({
  ownerId,
  self,
  target,
}: {
  ownerId: string | undefined;
  self: { id: string; role: GroupRole; userId: string } | undefined;
  target: { id: string; role: GroupRole; userId: string };
}) => {
  const isSelf = target.id === self?.id;
  const targetIsOwner = target.userId === ownerId;
  return {
    changeRole: self?.role === "ADMIN" && !isSelf && !targetIsOwner,
    makeOwner: self?.userId === ownerId && !isSelf && target.role === "ADMIN",
    leaveOrRemove:
      isSelf ||
      (canEditGroup(self?.role) &&
        !targetIsOwner &&
        (self?.role === "ADMIN" || target.role === "MEMBER")),
  };
};
