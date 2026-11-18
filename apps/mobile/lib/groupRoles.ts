import type { RouterOutputs } from "./api.ts";

export type GroupRole = RouterOutputs["groupMembership"]["list"][number]["members"][number]["role"];

export const groupRoles = ["ADMIN", "EDITOR", "MEMBER"] as const satisfies readonly GroupRole[];

export const roleLabel = (role: GroupRole) =>
  ({ ADMIN: "Admin", EDITOR: "Editor", MEMBER: "Member" })[role];

export const canEditGroup = (role: GroupRole | undefined) => role === "ADMIN" || role === "EDITOR";
