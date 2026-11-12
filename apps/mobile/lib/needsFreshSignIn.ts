import { TRPCClientError } from "@trpc/client";

export const needsFreshSignIn = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === "FORBIDDEN" && !error.data.cause;
