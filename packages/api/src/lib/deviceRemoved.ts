import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import { ReasonError } from "./reasonError.ts";

export class DeviceRemovedError extends ReasonError {
  constructor() {
    super(deviceRemovedCause);
    this.name = "DeviceRemovedError";
  }
}

export const deviceRemovedError = () =>
  new TRPCError({
    code: "UNAUTHORIZED",
    message: "This phone was removed from your account.",
    cause: new DeviceRemovedError(),
  });
