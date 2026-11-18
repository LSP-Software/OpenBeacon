import { GroupRole } from "@openbeacon/database";
import { TRPCError } from "@trpc/server";

export const isAdminOrEditor = (role: GroupRole | null | undefined) =>
  role === GroupRole.ADMIN || role === GroupRole.EDITOR;

export const notAdminOrEditorError = () =>
  new TRPCError({ code: "FORBIDDEN", message: "You are not an Admin or Editor of this group" });
