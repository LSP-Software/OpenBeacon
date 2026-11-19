import type { RouterOutputs } from "./api.ts";

export type GroupRole = RouterOutputs["groupMembership"]["list"][number]["members"][number]["role"];

const groupRoles = ["ADMIN", "EDITOR", "MEMBER"] as const satisfies readonly GroupRole[];

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
  const isOwner = self?.userId === ownerId;
  const targetIsOwner = target.userId === ownerId;
  const canChangeRole =
    self?.role === "ADMIN" && !isSelf && !targetIsOwner && (isOwner || target.role !== "ADMIN");
  const roleChoices: GroupRole[] = canChangeRole
    ? groupRoles.filter((role) => isOwner || role !== "ADMIN")
    : [];
  return {
    roleChoices,
    makeOwner: isOwner && !isSelf && target.role === "ADMIN",
    leaveOrRemove:
      isSelf ||
      (canEditGroup(self?.role) &&
        !targetIsOwner &&
        (target.role === "MEMBER" ||
          (self?.role === "ADMIN" && (target.role === "EDITOR" || isOwner)))),
  };
};
