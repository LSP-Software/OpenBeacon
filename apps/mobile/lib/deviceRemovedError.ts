import { deviceRemovedCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

export const isDeviceRemovedError = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.cause === deviceRemovedCause;
