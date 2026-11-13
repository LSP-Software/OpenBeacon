import type { ErrorReason } from "@openbeacon/shared";

export class ReasonError extends Error {
  readonly reason: ErrorReason;

  constructor(reason: ErrorReason) {
    super(reason);
    this.name = "ReasonError";
    this.reason = reason;
  }
}
