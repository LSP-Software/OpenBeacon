import { GroupRole } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";
import { ReasonError } from "./reasonError.ts";

export const isAdminOrEditor = (role: GroupRole | null | undefined) =>
  role === GroupRole.ADMIN || role === GroupRole.EDITOR;

export const notAdminOrEditorError = () =>
  new TRPCError({ code: "FORBIDDEN", message: "You are not an Admin or Editor of this group" });

export const notOwnerError = () =>
  new TRPCError({ code: "FORBIDDEN", message: "You are not the owner of this group" });

export const groupGoneError = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "This group no longer exists.",
    cause: new ReasonError("GROUP_GONE"),
  });

export const visibleOwnershipOffer = (
  group: { ownerId: string; ownershipOfferedToId: string | null },
  userId: string,
) =>
  userId === group.ownerId || userId === group.ownershipOfferedToId
    ? group.ownershipOfferedToId
    : null;
