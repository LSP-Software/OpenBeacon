import { errorReason } from "./errorReason.ts";

export const groupLimitAlert = (error: unknown) =>
  errorReason(error) === "GROUP_LIMIT_REACHED"
    ? {
        title: "Too many groups",
        message:
          "You're already in as many groups as your account allows. Leave a group before creating or joining another.",
      }
    : null;
