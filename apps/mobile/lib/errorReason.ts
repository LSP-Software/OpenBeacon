import { type ErrorReason, errorReasons } from "@openbeacon/shared";

export const errorReason = (error: unknown): ErrorReason | null => {
  if (typeof error !== "object" || error === null) return null;
  const value =
    "data" in error && typeof error.data === "object" && error.data !== null
      ? "reason" in error.data
        ? error.data.reason
        : null
      : "code" in error
        ? error.code
        : null;
  return errorReasons.find((reason) => reason === value) ?? null;
};
