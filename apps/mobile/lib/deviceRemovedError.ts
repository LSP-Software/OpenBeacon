import { deviceRemovedCause } from "@openbeacon/shared";
import { errorReason } from "./errorReason.ts";

export const isDeviceRemovedError = (error: unknown) => errorReason(error) === deviceRemovedCause;
