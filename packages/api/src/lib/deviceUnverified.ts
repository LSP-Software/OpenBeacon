import { deviceUnverifiedCause } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";

export class DeviceUnverifiedError extends Error {
  constructor() {
    super(deviceUnverifiedCause);
    this.name = "DeviceUnverifiedError";
  }
}

export const deviceUnverifiedError = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "This phone needs to confirm it's yours. Try again.",
    cause: new DeviceUnverifiedError(),
  });
