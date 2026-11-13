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
] as const;

export type ErrorReason = (typeof errorReasons)[number];
