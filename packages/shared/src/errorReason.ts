import { devicePendingCause, deviceRemovedCause, deviceUnverifiedCause } from "./deviceRemoved.ts";

export const errorReasons = [
  deviceRemovedCause,
  devicePendingCause,
  deviceUnverifiedCause,
  "NOT_GROUP_MEMBER",
  "GROUP_GONE",
  "DEVICE_NOT_REGISTERED",
  "GROUP_LIMIT_REACHED",
  "UPLOAD_LIMIT_REACHED",
  "TOO_MANY_PASSWORD_ATTEMPTS",
  "FRESH_SIGN_IN_REQUIRED",
  "RECOVERY_CHANGED",
  "EMAIL_CONFIRMATION_REQUIRED",
  "INVALID_CODE",
  "CODE_EXPIRED",
  "ALREADY_SET_UP",
  "NO_APPROVING_DEVICE",
  "HISTORY_RECIPIENT_MISMATCH",
] as const;

export type ErrorReason = (typeof errorReasons)[number];
