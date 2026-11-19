import { errorReason } from "./errorReason.ts";

export const limitAlert = (error: unknown) => {
  const reason = errorReason(error);
  if (reason === "GROUP_LIMIT_REACHED") {
    return {
      title: "Too many groups",
      message:
        "You're already in as many groups as your account allows. Leave a group before creating or joining another.",
    };
  }
  if (reason !== "NO_FREE_SEATS" && reason !== "GROUP_FULL") return null;
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return { title: reason === "GROUP_FULL" ? "Group full" : "No room", message };
};
