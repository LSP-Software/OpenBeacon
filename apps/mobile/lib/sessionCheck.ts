import { authClient } from "./auth-client.ts";

let lastSessionCheck = 0;

export const isUnauthorizedError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "data" in error &&
  typeof error.data === "object" &&
  error.data !== null &&
  "code" in error.data &&
  error.data.code === "UNAUTHORIZED";

export const checkSessionAfterUnauthorized = () => {
  if (Date.now() - lastSessionCheck < 5_000) return;
  lastSessionCheck = Date.now();
  authClient.$store.notify("$sessionSignal");
};
