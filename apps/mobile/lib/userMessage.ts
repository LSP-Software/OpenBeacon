import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { errorReason } from "./errorReason.ts";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";

const FALLBACK = "Something went wrong. Please try again.";

export const userMessage = (error: unknown) => {
  if (error instanceof TRPCClientError) {
    if (!error.data) return SERVER_UNREACHABLE_MESSAGE;
    if (error.data.code === "UNAUTHORIZED") {
      return "You’ve been signed out. Sign in again to keep using this phone.";
    }
    switch (errorReason(error)) {
      case deviceRemovedCause:
        return "This phone was removed from your account.";
      case "DEVICE_NOT_REGISTERED":
        return "This phone is still being set up. Try again in a minute.";
      case "NOT_GROUP_MEMBER":
      case "GROUP_GONE":
        return "You’re no longer in this group.";
      case "EPOCH_NOT_LATEST":
      case "EPOCH_ROTATION_PENDING":
        return "This group’s keys are changing. Try again in a moment.";
    }
    if (error.data.zodError) return FALLBACK;
    return error.message || FALLBACK;
  }
  if (!(error instanceof Error) || !error.message) return FALLBACK;
  if (error.message === "Network request failed") return SERVER_UNREACHABLE_MESSAGE;
  return error.message;
};
